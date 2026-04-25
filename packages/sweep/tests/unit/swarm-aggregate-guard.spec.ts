import { beforeEach, describe, expect, it, vi } from "vitest";
import Redis from "ioredis-mock";
import { stepContextStore, type StepEvent } from "@interview/shared/observability";
import { SwarmService } from "../../src/sim/swarm.service";
import { RedisSwarmAggregateGate } from "../../src/sim/swarm-aggregate-gate";

describe("RedisSwarmAggregateGate", () => {
  it("claims exactly once until released or reset", async () => {
    const redis = new Redis();
    const gate = new RedisSwarmAggregateGate(redis, { ttlSec: 60 });

    await expect(gate.claim(7)).resolves.toBe(true);
    await expect(gate.claim(7)).resolves.toBe(false);

    await gate.release(7);
    await expect(gate.claim(7)).resolves.toBe(true);

    await gate.reset(7);
    await expect(gate.claim(7)).resolves.toBe(true);
  });
});

describe("SwarmService aggregate guard", () => {
  const aggregateGate = {
    reset: vi.fn(async () => undefined),
    claim: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
  };
  const store = {
    insertSwarm: vi.fn(async () => 11),
    updateRunStatus: vi.fn(async () => undefined),
  };
  const orchestrator = {
    createFish: vi.fn(async ({ fishIndex }: { fishIndex: number }) => ({
      simRunId: fishIndex + 100,
    })),
  };
  const queue = {
    enqueueSwarmFish: vi.fn(async () => undefined),
    enqueueSwarmAggregate: vi.fn(async () => undefined),
  };
  const swarmStore = {
    getSwarm: vi.fn(async () => ({
      id: 11,
      kind: "telemetry",
      title: "swarm",
      baseSeed: {},
      size: 2,
      config: { fishConcurrency: 2 },
      status: "running",
      outcomeReportFindingId: null,
      suggestionId: null,
    })),
    countFishByStatus: vi.fn(async () => ({
      done: 2,
      failed: 0,
      timeout: 0,
      running: 0,
      pending: 0,
      paused: 0,
    })),
    claimPendingFishForSwarm: vi.fn(async () => []),
    abortSwarm: vi.fn(async () => undefined),
  };
  const kindGuard = {
    validateLaunch: vi.fn(() => undefined),
    defaultMaxTurns: vi.fn(() => 4),
  };
  const perturbationPack = {
    applyToSeed: vi.fn(({ baseSeed }: { baseSeed: Record<string, unknown> }) => baseSeed),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    aggregateGate.claim.mockResolvedValue(true);
    queue.enqueueSwarmAggregate.mockResolvedValue(undefined);
    swarmStore.getSwarm.mockResolvedValue({
      id: 11,
      kind: "telemetry",
      title: "swarm",
      baseSeed: {},
      size: 2,
      config: { fishConcurrency: 2 },
      status: "running",
      outcomeReportFindingId: null,
      suggestionId: null,
    });
    swarmStore.countFishByStatus.mockResolvedValue({
      done: 2,
      failed: 0,
      timeout: 0,
      running: 0,
      pending: 0,
      paused: 0,
    });
    swarmStore.claimPendingFishForSwarm.mockResolvedValue([]);
  });

  it("resets stale aggregate claims when launching a new swarm", async () => {
    const service = new SwarmService({
      store,
      swarmStore,
      orchestrator,
      queue,
      aggregateGate,
      kindGuard,
      perturbationPack,
    });

    const events: StepEvent[] = [];
    const result = await stepContextStore.run(
      { onStep: (event) => events.push(event) },
      () =>
        service.launchSwarm({
          kind: "telemetry",
          title: "test swarm",
          baseSeed: { target: 7 },
          perturbations: [{ kind: "noop" }, { kind: "shifted" }],
          config: {
            llmMode: "fixtures",
            quorumPct: 0.6,
            perFishTimeoutMs: 1000,
            fishConcurrency: 2,
            nanoModel: "stub",
            seed: 42,
          },
        }),
    );

    expect(result.swarmId).toBe(11);
    expect(aggregateGate.reset).toHaveBeenCalledWith(11);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: "swarm", phase: "start", swarmId: 11 }),
        expect.objectContaining({ step: "swarm", phase: "done", swarmId: 11 }),
      ]),
    );
  });

  it("only enqueues up to fishConcurrency at launch", async () => {
    const service = new SwarmService({
      store,
      swarmStore,
      orchestrator,
      queue,
      aggregateGate,
      kindGuard,
      perturbationPack,
    });
    swarmStore.countFishByStatus.mockResolvedValueOnce({
      done: 0,
      failed: 0,
      timeout: 0,
      running: 0,
      pending: 3,
      paused: 0,
    });
    swarmStore.claimPendingFishForSwarm.mockResolvedValueOnce([
      { simRunId: 100, fishIndex: 0 },
      { simRunId: 101, fishIndex: 1 },
    ]);

    await service.launchSwarm({
      kind: "telemetry",
      title: "test swarm",
      baseSeed: { target: 7 },
      perturbations: [{ kind: "noop" }, { kind: "shifted" }, { kind: "lagged" }],
      config: {
        llmMode: "fixtures",
        quorumPct: 0.6,
        perFishTimeoutMs: 1000,
        fishConcurrency: 2,
        nanoModel: "stub",
        seed: 42,
      },
    });

    expect(swarmStore.claimPendingFishForSwarm).toHaveBeenCalledWith(11, 2);
    expect(queue.enqueueSwarmFish).toHaveBeenCalledTimes(2);
    expect(queue.enqueueSwarmFish).toHaveBeenNthCalledWith(1, {
      swarmId: 11,
      simRunId: 100,
      fishIndex: 0,
      jobId: "swarm-11-fish-0",
    });
    expect(queue.enqueueSwarmFish).toHaveBeenNthCalledWith(2, {
      swarmId: 11,
      simRunId: 101,
      fishIndex: 1,
      jobId: "swarm-11-fish-1",
    });
  });

  it("claims the next pending fish on completion before aggregation", async () => {
    const service = new SwarmService({
      store,
      swarmStore,
      orchestrator,
      queue,
      aggregateGate,
      kindGuard,
      perturbationPack,
    });
    swarmStore.countFishByStatus
      .mockResolvedValueOnce({
        done: 1,
        failed: 0,
        timeout: 0,
        running: 1,
        pending: 1,
        paused: 0,
      })
      .mockResolvedValueOnce({
        done: 1,
        failed: 0,
        timeout: 0,
        running: 2,
        pending: 0,
        paused: 0,
      });
    swarmStore.claimPendingFishForSwarm.mockResolvedValueOnce([
      { simRunId: 102, fishIndex: 2 },
    ]);

    await expect(service.onFishComplete(11)).resolves.toEqual({
      aggregateEnqueued: false,
    });

    expect(swarmStore.claimPendingFishForSwarm).toHaveBeenCalledWith(11, 1);
    expect(queue.enqueueSwarmFish).toHaveBeenCalledWith({
      swarmId: 11,
      simRunId: 102,
      fishIndex: 2,
      jobId: "swarm-11-fish-2",
    });
    expect(queue.enqueueSwarmAggregate).not.toHaveBeenCalled();
  });

  it("rejects swarms that do not reserve fish 0 for a noop baseline", async () => {
    const service = new SwarmService({
      store,
      swarmStore,
      orchestrator,
      queue,
      aggregateGate,
      kindGuard,
      perturbationPack,
    });

    await expect(
      service.launchSwarm({
        kind: "telemetry",
        title: "test swarm",
        baseSeed: { target: 7 },
        perturbations: [{ kind: "shifted" }],
        config: {
          llmMode: "fixtures",
          quorumPct: 0.6,
          perFishTimeoutMs: 1000,
          fishConcurrency: 2,
          nanoModel: "stub",
          seed: 42,
        },
      }),
    ).rejects.toThrow(/fish 0 perturbation/);
  });

  it("enqueues aggregate only once when concurrent completions race", async () => {
    const service = new SwarmService({
      store,
      swarmStore,
      orchestrator,
      queue,
      aggregateGate,
      kindGuard,
      perturbationPack,
    });
    aggregateGate.claim
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const events: StepEvent[] = [];
    await expect(
      stepContextStore.run(
        { onStep: (event) => events.push(event) },
        () => service.onFishComplete(11),
      ),
    ).resolves.toEqual({ aggregateEnqueued: true });
    await expect(service.onFishComplete(11)).resolves.toEqual({
      aggregateEnqueued: false,
    });

    expect(queue.enqueueSwarmAggregate).toHaveBeenCalledTimes(1);
    expect(queue.enqueueSwarmAggregate).toHaveBeenCalledWith({
      swarmId: 11,
      jobId: "swarm-11-aggregate",
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "aggregator",
          phase: "start",
          swarmId: 11,
          queued: true,
        }),
      ]),
    );
  });

  it("counts timed-out fish as accounted for aggregation", async () => {
    const service = new SwarmService({
      store,
      swarmStore,
      orchestrator,
      queue,
      aggregateGate,
      kindGuard,
      perturbationPack,
    });
    swarmStore.countFishByStatus.mockResolvedValueOnce({
      done: 1,
      failed: 0,
      timeout: 1,
      running: 0,
      pending: 0,
      paused: 0,
    });

    await expect(service.onFishComplete(11)).resolves.toEqual({
      aggregateEnqueued: true,
    });

    expect(queue.enqueueSwarmAggregate).toHaveBeenCalledWith({
      swarmId: 11,
      jobId: "swarm-11-aggregate",
    });
  });

  it("releases the claim if aggregate enqueue fails", async () => {
    const service = new SwarmService({
      store,
      swarmStore,
      orchestrator,
      queue,
      aggregateGate,
      kindGuard,
      perturbationPack,
    });
    queue.enqueueSwarmAggregate.mockRejectedValueOnce(new Error("queue down"));

    await expect(service.onFishComplete(11)).rejects.toThrow("queue down");
    expect(aggregateGate.release).toHaveBeenCalledWith(11);
  });
});

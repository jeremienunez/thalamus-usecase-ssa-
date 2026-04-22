import { beforeEach, describe, expect, it, vi } from "vitest";
import Redis from "ioredis-mock";
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
      config: {},
      status: "running",
      outcomeReportFindingId: null,
      suggestionId: null,
    })),
    countFishByStatus: vi.fn(async () => ({
      done: 2,
      failed: 0,
      running: 0,
      pending: 0,
      paused: 0,
    })),
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

    const result = await service.launchSwarm({
      kind: "telemetry",
      title: "test swarm",
      baseSeed: { target: 7 },
      perturbations: [{ kind: "baseline" }, { kind: "shifted" }],
      config: {
        llmMode: "fixtures",
        quorumPct: 0.6,
        perFishTimeoutMs: 1000,
        fishConcurrency: 2,
        nanoModel: "stub",
        seed: 42,
      },
    });

    expect(result.swarmId).toBe(11);
    expect(aggregateGate.reset).toHaveBeenCalledWith(11);
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

    await expect(service.onFishComplete(11)).resolves.toEqual({
      aggregateEnqueued: true,
    });
    await expect(service.onFishComplete(11)).resolves.toEqual({
      aggregateEnqueued: false,
    });

    expect(queue.enqueueSwarmAggregate).toHaveBeenCalledTimes(1);
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

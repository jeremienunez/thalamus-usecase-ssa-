import { describe, expect, it, vi } from "vitest";
import type { SimSwarmRow } from "../../../src/types/sim-swarm.types";
import { SimSwarmStoreService } from "../../../src/services/sim-swarm-store.service";

describe("SimSwarmStoreService", () => {
  it("maps persisted ids to numbers on reads", async () => {
    const swarm: SimSwarmRow = {
      id: 42n,
      kind: "telemetry",
      title: "Swarm 42",
      baseSeed: { target: 7 },
      perturbations: [],
      size: 3,
      config: {
        llmMode: "fixtures",
        quorumPct: 60,
        perFishTimeoutMs: 1000,
        fishConcurrency: 1,
        nanoModel: "stub",
        seed: 42,
      },
      status: "running",
      outcomeReportFindingId: 99n,
      suggestionId: 100n,
      startedAt: new Date("2026-04-22T00:00:00Z"),
      completedAt: null,
      createdBy: null,
    };
    const swarmRepo = {
      findById: vi.fn(async () => swarm),
      abortSwarm: vi.fn(async () => undefined),
      snapshotAggregate: vi.fn(async () => undefined),
      closeSwarm: vi.fn(async () => undefined),
    };
    const runRepo = {
      countFishByStatus: vi.fn(async () => ({
        done: 1,
        failed: 0,
        timeout: 0,
        running: 2,
        pending: 0,
        paused: 0,
      })),
    };
    const terminalRepo = {
      listTerminalsForSwarm: vi.fn(async () => []),
      listTerminalActionsForSwarm: vi.fn(async () => []),
    };
    const svc = new SimSwarmStoreService(swarmRepo, runRepo, terminalRepo);

    expect(await svc.getSwarm(42)).toMatchObject({
      id: 42,
      kind: "telemetry",
      title: "Swarm 42",
      baseSeed: { target: 7 },
      size: 3,
      config: {
        llmMode: "fixtures",
        quorumPct: 60,
        perFishTimeoutMs: 1000,
        fishConcurrency: 1,
        nanoModel: "stub",
        seed: 42,
      },
      status: "running",
      outcomeReportFindingId: 99,
      suggestionId: 100,
    });
    expect(await svc.countFishByStatus(42)).toEqual({
      done: 1,
      failed: 0,
      timeout: 0,
      running: 2,
      pending: 0,
      paused: 0,
    });
  });

  it("delegates abort, aggregate snapshots and close writes to the swarm repo", async () => {
    const swarmRepo = {
      findById: vi.fn(async () => null),
      abortSwarm: vi.fn(async () => undefined),
      snapshotAggregate: vi.fn(async () => undefined),
      closeSwarm: vi.fn(async () => undefined),
    };
    const runRepo = {
      countFishByStatus: vi.fn(async () => ({
        done: 0,
        failed: 0,
        timeout: 0,
        running: 0,
        pending: 0,
        paused: 0,
      })),
    };
    const terminalRepo = {
      listTerminalsForSwarm: vi.fn(async () => []),
      listTerminalActionsForSwarm: vi.fn(async () => []),
    };
    const svc = new SimSwarmStoreService(swarmRepo, runRepo, terminalRepo);
    const completedAt = new Date("2026-04-22T12:30:00Z");

    await svc.abortSwarm(7);
    await svc.snapshotAggregate({
      swarmId: 7,
      key: "aggregate_pc",
      value: { consensus: "hold" },
    });
    await svc.closeSwarm({
      swarmId: 7,
      status: "done",
      suggestionId: 11,
      reportFindingId: 12,
      completedAt,
    });

    expect(swarmRepo.abortSwarm).toHaveBeenCalledWith(7n);
    expect(swarmRepo.snapshotAggregate).toHaveBeenCalledWith({
      swarmId: 7n,
      key: "aggregate_pc",
      value: { consensus: "hold" },
    });
    expect(swarmRepo.closeSwarm).toHaveBeenCalledWith({
      swarmId: 7n,
      status: "done",
      suggestionId: 11n,
      reportFindingId: 12n,
      completedAt,
    });
  });
});

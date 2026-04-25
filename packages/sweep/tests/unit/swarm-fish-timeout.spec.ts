import { describe, expect, it, vi } from "vitest";
import {
  processSwarmFishJob,
  type SwarmFishWorkerDeps,
} from "../../src/jobs/workers/swarm-fish.worker";

function makeDeps(
  overrides: Partial<SwarmFishWorkerDeps> = {},
): SwarmFishWorkerDeps {
  const store = {
    getRun: vi.fn(async () => ({
      swarmId: 7,
      kind: "uc3_conjunction",
      status: "running",
      config: {
        turnsPerDay: 1,
        maxTurns: 3,
        llmMode: "fixtures",
        seed: 42,
        nanoModel: "stub",
        perFishTimeoutMs: 5,
      },
    })),
    updateRunStatus: vi.fn(async () => undefined),
  };
  const sequentialRunner = {
    runTurn: vi.fn(
      async ({ signal }: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
    ),
  };

  const deps: SwarmFishWorkerDeps = {
    store,
    swarmService: {
      onFishComplete: vi.fn(async () => ({ aggregateEnqueued: false })),
    },
    sequentialRunner,
    dagRunner: {
      runTurn: vi.fn(async () => ({
        simRunId: 22,
        turnIndex: 0,
        agentResults: [],
        failedAgents: [],
      })),
    },
    kindGuard: {
      driverForKind: vi.fn(() => ({
        runner: "sequential",
        singleTurn: false,
      })),
      validateLaunch: vi.fn(() => undefined),
      defaultMaxTurns: vi.fn(() => 3),
    },
  };
  return { ...deps, ...overrides };
}

describe("swarm fish timeout", () => {
  it("marks a timed-out fish as timeout and still notifies aggregation", async () => {
    const deps = makeDeps();

    await expect(
      processSwarmFishJob(deps, {
        swarmId: 7,
        simRunId: 22,
        fishIndex: 1,
      }),
    ).resolves.toEqual({ timeout: true });

    expect(deps.sequentialRunner.runTurn).toHaveBeenCalledWith({
      simRunId: 22,
      turnIndex: 0,
      signal: expect.any(AbortSignal),
    });
    expect(deps.store.updateRunStatus).toHaveBeenCalledWith(
      22,
      "timeout",
      expect.any(Date),
    );
    expect(deps.swarmService.onFishComplete).toHaveBeenCalledWith(7);
  });

  it("keeps non-timeout failures as failed jobs", async () => {
    const boom = new Error("bad turn");
    const sequentialRunner: SwarmFishWorkerDeps["sequentialRunner"] = {
      runTurn: vi.fn(async () => {
        throw boom;
      }),
    };
    const deps = makeDeps({
      sequentialRunner,
    });

    await expect(
      processSwarmFishJob(deps, {
        swarmId: 7,
        simRunId: 22,
        fishIndex: 1,
      }),
    ).rejects.toThrow("bad turn");

    expect(deps.store.updateRunStatus).toHaveBeenCalledWith(
      22,
      "failed",
      expect.any(Date),
    );
    expect(deps.swarmService.onFishComplete).toHaveBeenCalledWith(7);
  });

  it("times out even when the runner does not observe the AbortSignal", async () => {
    const sequentialRunner: SwarmFishWorkerDeps["sequentialRunner"] = {
      runTurn: vi.fn(async () => new Promise<never>(() => undefined)),
    };
    const deps = makeDeps({
      sequentialRunner,
    });

    await expect(
      processSwarmFishJob(deps, {
        swarmId: 7,
        simRunId: 22,
        fishIndex: 1,
      }),
    ).resolves.toEqual({ timeout: true });

    expect(deps.store.updateRunStatus).toHaveBeenCalledWith(
      22,
      "timeout",
      expect.any(Date),
    );
    expect(deps.swarmService.onFishComplete).toHaveBeenCalledWith(7);
  });
});

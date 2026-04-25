import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIM_EMBEDDING_CONFIG,
  DEFAULT_SIM_SWARM_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import { AggregatorService } from "../../src/sim/aggregator.service";
import { MemoryService } from "../../src/sim/memory.service";
import { SimOrchestrator } from "../../src/sim/sim-orchestrator.service";
import {
  setSimEmbeddingConfigProvider,
  setSimSwarmConfigProvider,
} from "../../src";

afterEach(() => {
  setSimSwarmConfigProvider(
    new StaticConfigProvider(DEFAULT_SIM_SWARM_CONFIG),
  );
  setSimEmbeddingConfigProvider(
    new StaticConfigProvider(DEFAULT_SIM_EMBEDDING_CONFIG),
  );
});

describe("sim runtime config providers", () => {
  it("applies sim.swarm defaults when starting a standalone run", async () => {
    setSimSwarmConfigProvider(
      new StaticConfigProvider({
        defaultFishConcurrency: 3,
        defaultQuorumPct: 0.65,
        defaultPerFishTimeoutMs: 12_345,
      }),
    );

    const store = {
      insertSwarm: vi.fn(async () => 11),
      insertRun: vi.fn(async () => 22),
      insertAgent: vi.fn(async ({ agentIndex }: { agentIndex: number }) => agentIndex + 100),
      getRun: vi.fn(async () => null),
      listAgents: vi.fn(async () => []),
      insertGodTurn: vi.fn(async () => 0),
      listGodEventsAtOrBefore: vi.fn(async () => []),
      persistTurnBatch: vi.fn(async () => []),
      writeMemoryBatch: vi.fn(async () => []),
      updateRunStatus: vi.fn(async () => undefined),
      countAgentTurnsForRun: vi.fn(async () => 0),
      lastTurnCreatedAt: vi.fn(async () => null),
      recentObservable: vi.fn(async () => []),
      topKByVector: vi.fn(async () => []),
      topKByRecency: vi.fn(async () => []),
    };
    const queue = {
      enqueueSimTurn: vi.fn(async () => undefined),
      enqueueSwarmFish: vi.fn(async () => undefined),
      enqueueSwarmAggregate: vi.fn(async () => undefined),
    };
    const subjects = {
      getSubject: vi.fn(async () => ({
        displayName: "SAT-1",
        attributes: {},
      })),
      getAuthorLabels: vi.fn(async () => new Map()),
    };
    const persona = {
      compose: vi.fn(() => ({
        persona: "pilot",
        goals: ["protect asset"],
        constraints: {},
      })),
    };
    const perturbationPack = {
      generateSet: vi.fn(() => []),
      applyToSeed: vi.fn(({ baseSeed }: { baseSeed: Record<string, unknown> }) => baseSeed),
      agentHints: vi.fn(() => ({ subjectHintsByIndex: new Map() })),
      extractGodEvents: vi.fn(() => []),
    };

    const orchestrator = new SimOrchestrator({
      store,
      queue,
      subjects,
      persona,
      perturbationPack,
    });

    await orchestrator.startStandalone({
      kind: "ssa_negotiation",
      title: "Test swarm",
      subjectIds: [7, 8],
      llmMode: "fixtures",
    });

    expect(store.insertSwarm).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          fishConcurrency: 3,
          quorumPct: 0.65,
          perFishTimeoutMs: 12_345,
        }),
      }),
    );
  });

  it("applies sim.embedding concurrency to MemoryService.writeMany", async () => {
    setSimEmbeddingConfigProvider(
      new StaticConfigProvider({ embedConcurrency: 1 }),
    );

    let inFlight = 0;
    let maxInFlight = 0;
    const embed = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
      return [1, 2, 3];
    });

    const service = new MemoryService(
      {
        writeMemoryBatch: vi.fn(async (rows) => rows.map((_, i) => i + 1)),
        insertSwarm: vi.fn(),
        insertRun: vi.fn(),
        insertAgent: vi.fn(),
        getRun: vi.fn(),
        listAgents: vi.fn(),
        insertGodTurn: vi.fn(),
        listGodEventsAtOrBefore: vi.fn(),
        persistTurnBatch: vi.fn(),
        updateRunStatus: vi.fn(),
        countAgentTurnsForRun: vi.fn(),
        lastTurnCreatedAt: vi.fn(),
        recentObservable: vi.fn(),
        topKByVector: vi.fn(),
        topKByRecency: vi.fn(),
      },
      embed,
      {
        getSubject: vi.fn(),
        getAuthorLabels: vi.fn(async () => new Map()),
      },
    );

    await service.writeMany([
      { simRunId: 1, agentId: 1, turnIndex: 0, kind: "belief", content: "a" },
      { simRunId: 1, agentId: 1, turnIndex: 1, kind: "belief", content: "b" },
      { simRunId: 1, agentId: 1, turnIndex: 2, kind: "belief", content: "c" },
    ]);

    expect(embed).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);
  });

  it("applies sim.embedding concurrency to AggregatorService.aggregate", async () => {
    setSimEmbeddingConfigProvider(
      new StaticConfigProvider({ embedConcurrency: 1 }),
    );

    let inFlight = 0;
    let maxInFlight = 0;
    const embed = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
      return [1, 0, 0];
    });

    const service = new AggregatorService({
      swarmStore: {
        getSwarm: vi.fn(async () => ({
          size: 3,
          config: { quorumPct: 0.5 },
        })),
        listTerminalsForSwarm: vi.fn(async () => [
          terminalRow(1, 0, "hold"),
          terminalRow(2, 1, "hold"),
          terminalRow(3, 2, "maneuver"),
        ]),
      },
      embed,
      strategy: {
        labelAction: vi.fn((action) => String(action?.kind ?? "unknown")),
        clusterFallback: vi.fn(() => []),
      },
    });

    const result = await service.aggregate(9);

    expect(result.quorumMet).toBe(true);
    expect(embed).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);
  });
});

function terminalRow(simRunId: number, fishIndex: number, kind: string) {
  return {
    simRunId,
    fishIndex,
    agentIndex: 0,
    action: { kind },
    observableSummary: `${kind}-${fishIndex}`,
    runStatus: "done",
    turnsPlayed: 3,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

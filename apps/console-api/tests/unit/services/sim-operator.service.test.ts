import { describe, expect, it, vi } from "vitest";
import type { SimSwarmRow } from "../../../src/types/sim-swarm.types";
import type { SimRunRow } from "../../../src/types/sim-run.types";
import type { SimAgentRow } from "../../../src/types/sim-agent.types";
import type { SimTurnRow } from "../../../src/types/sim-turn.types";
import type { SimFishTerminalRow } from "../../../src/types/sim-terminal.types";
import { SimOperatorService } from "../../../src/services/sim-operator.service";

function makeSwarm(status: "done" | "running" = "done"): SimSwarmRow {
  const config = {
    llmMode: "fixtures",
    quorumPct: 0.8,
    perFishTimeoutMs: 1000,
    fishConcurrency: 1,
    nanoModel: "stub",
    seed: 42,
    aggregate: {
      quorumMet: true,
      clusters: [
        {
          label: "maneuver",
          fraction: 1,
          memberFishIndexes: [0],
        },
      ],
    },
  } satisfies SimSwarmRow["config"] & {
    aggregate: Record<string, unknown>;
  };

  return {
    id: 1n,
    kind: "uc3_conjunction",
    title: "Operator swarm",
    baseSeed: { target: 7 },
    perturbations: [{ kind: "noop" }],
    size: 1,
    config,
    status,
    outcomeReportFindingId: null,
    suggestionId: null,
    startedAt: new Date("2026-04-25T10:00:00Z"),
    completedAt:
      status === "done" ? new Date("2026-04-25T10:01:00Z") : null,
    createdBy: 1n,
  };
}

function makePcSwarm(): SimSwarmRow {
  return {
    ...makeSwarm("done"),
    kind: "uc_pc_estimator",
    config: {
      ...makeSwarm("done").config,
      aggregate: undefined,
      pcAggregate: {
        conjunctionId: 99,
        medianPc: 0.00021,
        fishCount: 3,
        clusters: [
          {
            label: "elliptical-overlap / degraded-covariance",
            mode: "elliptical-overlap",
            flags: ["degraded-covariance"],
            pcRange: [0.0002, 0.0003],
            fishCount: 2,
            memberFishIndexes: [1, 2],
            exemplarFishIndex: 1,
            exemplarSimRunId: 11,
          },
        ],
      },
    } as SimSwarmRow["config"],
  };
}

const run: SimRunRow = {
  id: 10n,
  swarmId: 1n,
  fishIndex: 0,
  kind: "uc3_conjunction",
  seedApplied: { target: 7 },
  perturbation: { kind: "noop" },
  config: {
    turnsPerDay: 4,
    maxTurns: 8,
    llmMode: "fixtures",
    seed: 42,
    nanoModel: "stub",
  },
  status: "done",
  reportFindingId: null,
  llmCostUsd: null,
  startedAt: new Date("2026-04-25T10:00:00Z"),
  completedAt: new Date("2026-04-25T10:01:00Z"),
};

const agent: SimAgentRow = {
  id: 100n,
  simRunId: 10n,
  operatorId: null,
  agentIndex: 0,
  persona: "operator",
  goals: [],
  constraints: {},
  createdAt: new Date("2026-04-25T10:00:00Z"),
};

const turn: SimTurnRow = {
  id: 1000n,
  simRunId: 10n,
  turnIndex: 1,
  actorKind: "agent",
  agentId: 100n,
  action: { kind: "maneuver" },
  rationale: "risk is high",
  observableSummary: "Fish chose maneuver",
  llmCostUsd: 0.01,
  createdAt: new Date("2026-04-25T10:00:30Z"),
};

const terminal: SimFishTerminalRow = {
  simRunId: 10n,
  fishIndex: 0,
  runStatus: "done",
  agentIndex: 0,
  action: { kind: "maneuver" },
  observableSummary: "Fish chose maneuver",
  turnsPlayed: 1,
};

function makeService(status: "done" | "running" = "done") {
  const llmCall = vi.fn(async () => ({
    content: "Fish 0 maneuvered because the terminal action says maneuver.",
    provider: "fixture",
  }));
  const evidenceInsert = vi.fn(async (input) => ({
    id: 500n,
    swarmId: input.swarmId,
    simRunId: input.simRunId ?? null,
    scope: input.scope,
    question: input.question,
    answer: input.answer,
    evidenceRefs: input.evidenceRefs,
    traceExcerpt: input.traceExcerpt,
    createdBy: input.createdBy ?? null,
    createdAt: new Date("2026-04-25T10:02:00Z"),
  }));
  const deps = {
    swarmRepo: {
      findById: vi.fn(async () => makeSwarm(status)),
      listForOperator: vi.fn(),
    },
    runRepo: {
      countFishByStatus: vi.fn(async () => ({
        done: status === "done" ? 1 : 0,
        failed: 0,
        timeout: 0,
        running: status === "running" ? 1 : 0,
        pending: 0,
        paused: 0,
      })),
      findBySwarmFish: vi.fn(async () => run),
    },
    agentRepo: {
      listByRun: vi.fn(async () => [agent]),
    },
    turnRepo: {
      listTimelineForRun: vi.fn(async () => [turn]),
    },
    terminalRepo: {
      listTerminalsForSwarm: vi.fn(async () => [terminal]),
    },
    evidenceRepo: {
      insert: evidenceInsert,
      listForSwarm: vi.fn(async () => []),
    },
    swarmStatus: {
      status: vi.fn(async () => ({
        swarmId: 1,
        kind: "uc3_conjunction",
        status,
        size: 1,
        done: status === "done" ? 1 : 0,
        failed: 0,
        timeout: 0,
        running: status === "running" ? 1 : 0,
        pending: 0,
        reportFindingId: null,
        suggestionId: null,
      })),
    },
    llm: {
      create: vi.fn(() => ({ call: llmCall })),
    },
  };
  return { service: new SimOperatorService(deps), deps, llmCall, evidenceInsert };
}

describe("SimOperatorService", () => {
  it("builds fish Q&A from read models and persists review evidence only", async () => {
    const { service, llmCall, evidenceInsert } = makeService("done");

    const result = await service.askQuestion({
      swarmId: 1n,
      scope: "fish",
      fishIndex: 0,
      question: "Why maneuver?",
      createdBy: 1n,
    });

    expect(result.provider).toBe("fixture");
    expect(llmCall).toHaveBeenCalledWith(
      expect.stringContaining('"question": "Why maneuver?"'),
      expect.any(Object),
    );
    expect(evidenceInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        swarmId: 1n,
        simRunId: 10n,
        scope: "fish",
        question: "Why maneuver?",
        answer: "Fish 0 maneuvered because the terminal action says maneuver.",
        createdBy: 1n,
      }),
    );
    expect(result.evidence.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "sim_swarm", id: "1" }),
        expect.objectContaining({ kind: "sim_run", id: "10", fishIndex: 0 }),
        expect.objectContaining({ kind: "sim_turn", id: "1000" }),
      ]),
    );
  });

  it("rejects Q&A while a swarm is still running", async () => {
    const { service, evidenceInsert } = makeService("running");

    await expect(
      service.askQuestion({
        swarmId: 1n,
        scope: "swarm",
        question: "What happened?",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(evidenceInsert).not.toHaveBeenCalled();
  });

  it("reads clusters from the persisted aggregate snapshot", async () => {
    const { service } = makeService("done");

    await expect(service.getClusters(1n)).resolves.toMatchObject({
      swarmId: "1",
      source: "aggregate",
      clusters: [expect.objectContaining({ label: "maneuver" })],
    });
  });

  it("normalizes pcAggregate clusters into fish-member DTOs", async () => {
    const { service, deps } = makeService("done");
    deps.swarmRepo.findById.mockResolvedValue(makePcSwarm());

    await expect(service.getClusters(1n)).resolves.toMatchObject({
      swarmId: "1",
      source: "pcAggregate",
      clusters: [
        {
          label: "elliptical-overlap / degraded-covariance",
          memberFishIndexes: [1, 2],
          exemplarFishIndex: 1,
          exemplarSimRunId: "11",
          fishCount: 2,
          pcRange: [0.0002, 0.0003],
          mode: "elliptical-overlap",
          flags: ["degraded-covariance"],
        },
      ],
    });
  });

  it("seeds deterministic auto-review evidence for terminal aggregate swarms", async () => {
    const { service, llmCall, evidenceInsert } = makeService("done");

    const rows = await service.listEvidence(1n);

    expect(llmCall).not.toHaveBeenCalled();
    expect(evidenceInsert).toHaveBeenCalledTimes(3);
    expect(rows.map((row) => row.question)).toEqual([
      "Auto-review: What is the swarm-level outcome?",
      "Auto-review: Which cluster drove the aggregate?",
      "Auto-review: Which fish looks outlier or uncertain?",
    ]);
    expect(evidenceInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "swarm",
        question: "Auto-review: What is the swarm-level outcome?",
        createdBy: null,
      }),
    );
  });
});

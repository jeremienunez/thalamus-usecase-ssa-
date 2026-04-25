import { describe, expect, it, vi } from "vitest";
import {
  AggregatorService,
  type SwarmAggregate,
} from "../../src/sim/aggregator.service";
import type {
  SimSwarmRecord,
  SimSwarmTerminalRow,
} from "../../src/sim/ports/swarm-store.port";
import type { SimAggregationStrategy } from "../../src/sim/ports";

const swarm: SimSwarmRecord = {
  id: 77,
  kind: "uc3_conjunction",
  title: "fixture deterministic swarm",
  baseSeed: { subjectIds: [101, 202], horizonDays: 2 },
  size: 4,
  config: {
    llmMode: "fixtures",
    quorumPct: 0.75,
    perFishTimeoutMs: 60_000,
    fishConcurrency: 4,
    nanoModel: "fixture-nano",
    seed: 4242,
  },
  status: "done",
  outcomeReportFindingId: null,
  suggestionId: null,
};

const terminals: SimSwarmTerminalRow[] = [
  terminal(100, 0, "maneuver", "alpha maneuver outcome", [0.94, 0.06]),
  terminal(101, 1, "maneuver", "beta maneuver outcome", [0.91, 0.09]),
  terminal(102, 2, "hold", "alpha hold outcome", [0.08, 0.92]),
  terminal(103, 3, "hold", "beta hold outcome", [0.05, 0.95]),
];
const vectorsBySummary = new Map<string, number[]>([
  ["alpha maneuver outcome", [0.94, 0.06]],
  ["beta maneuver outcome", [0.91, 0.09]],
  ["alpha hold outcome", [0.08, 0.92]],
  ["beta hold outcome", [0.05, 0.95]],
]);

const strategy: SimAggregationStrategy = {
  labelAction: (action) => String(action.kind ?? "unknown"),
  clusterFallback: (rows) => {
    const buckets = new Map<string, number[]>();
    for (const row of rows) {
      const kind = String(row.action.kind ?? "unknown");
      buckets.set(kind, [...(buckets.get(kind) ?? []), row.fishIndex]);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, memberFishIndexes]) => ({
        label,
        fraction: memberFishIndexes.length / rows.length,
        memberFishIndexes,
      }));
  },
};

describe("Seeded sim aggregate determinism", () => {
  it("replays the same fixture-backed swarm terminals into the same aggregate shape", async () => {
    const first = await aggregateFixtureSwarm();
    const second = await aggregateFixtureSwarm();

    expect(aggregateShape(second)).toEqual(aggregateShape(first));
    expect(aggregateShape(first)).toEqual({
      totalFish: 4,
      quorumMet: true,
      succeededFish: 4,
      failedFish: 0,
      modal: {
        actionKind: "maneuver",
        fraction: 0.5,
        exemplarSimRunId: 100,
        exemplarAction: { kind: "maneuver", vector: [0.94, 0.06] },
      },
      divergenceScore: 0.5,
      clusters: [
        {
          label: "maneuver",
          fraction: 0.5,
          memberFishIndexes: [0, 1],
          exemplarSimRunId: 100,
          exemplarAction: { kind: "maneuver", vector: [0.94, 0.06] },
          centroid: expect.any(Array),
        },
        {
          label: "hold",
          fraction: 0.5,
          memberFishIndexes: [2, 3],
          exemplarSimRunId: 102,
          exemplarAction: { kind: "hold", vector: [0.08, 0.92] },
          centroid: expect.any(Array),
        },
      ],
    });
  });
});

async function aggregateFixtureSwarm(): Promise<SwarmAggregate> {
  const service = new AggregatorService({
    swarmStore: {
      getSwarm: vi.fn(async () => swarm),
      listTerminalsForSwarm: vi.fn(async () => terminals),
    },
    embed: async (summary) => vectorsBySummary.get(summary) ?? null,
    strategy,
  });

  return service.aggregate(swarm.id);
}

function terminal(
  simRunId: number,
  fishIndex: number,
  kind: string,
  observableSummary: string,
  vector: number[],
): SimSwarmTerminalRow {
  return {
    simRunId,
    fishIndex,
    runStatus: "done",
    agentIndex: 0,
    action: { kind, vector },
    observableSummary,
    turnsPlayed: 2,
  };
}

function aggregateShape(aggregate: SwarmAggregate) {
  return {
    totalFish: aggregate.totalFish,
    quorumMet: aggregate.quorumMet,
    succeededFish: aggregate.succeededFish,
    failedFish: aggregate.failedFish,
    modal: aggregate.modal,
    divergenceScore: aggregate.divergenceScore,
    clusters: aggregate.clusters.map((cluster) => ({
      label: cluster.label,
      fraction: cluster.fraction,
      memberFishIndexes: cluster.memberFishIndexes,
      exemplarSimRunId: cluster.exemplarSimRunId,
      exemplarAction: cluster.exemplarAction,
      centroid: cluster.centroid,
    })),
  };
}

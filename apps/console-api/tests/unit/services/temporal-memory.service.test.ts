import { describe, expect, it, vi } from "vitest";
import { TemporalMemoryService } from "../../../src/services/temporal-memory.service";
import type {
  ListTemporalPatternsForMemoryInput,
  TemporalPatternMemoryRepositoryRow,
} from "../../../src/types/temporal.types";

const createdAt = new Date("2026-04-27T10:00:00Z");

describe("TemporalMemoryService", () => {
  it("queries accepted patterns by default and returns hypothesis-only DTOs", async () => {
    const rows = [memoryRow()];
    const listForMemory = vi.fn(async () => rows);
    const service = new TemporalMemoryService({
      patternRepo: { listForMemory },
    });

    const result = await service.queryPatterns({
      terminalStatus: "timeout",
      sourceDomain: "production",
    });

    expect(listForMemory).toHaveBeenCalledWith({
      statuses: ["accepted"],
      terminalStatus: "timeout",
      sourceDomain: "production",
      limit: 20,
    } satisfies ListTemporalPatternsForMemoryInput);
    expect(result.nextCursor).toBeNull();
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]).toMatchObject({
      patternId: "10",
      patternHash: "pattern-hash-1",
      status: "accepted",
      sourceDomain: "production",
      terminalStatus: "timeout",
      supportCount: 5,
      negativeSupportCount: 2,
      hypothesis: true,
      decisionAuthority: false,
    });
    expect(result.patterns[0]?.sequence).toEqual([
      {
        stepIndex: 0,
        eventSignature: "fish.high_uncertainty|fish|none|none",
        avgDeltaMs: 200,
        supportCount: 5,
      },
    ]);
    expect(result.patterns[0]?.examples).toEqual([
      {
        eventId: "positive-event",
        role: "positive",
        entityId: "sim_swarm:23",
        simRunId: "77",
        fishIndex: 1,
        turnIndex: 2,
        embeddingId: "embedding-1",
        occurredAt: "2026-04-27T10:00:00.000Z",
      },
    ]);
    expect(result.patterns[0]?.counterexamples).toEqual([
      {
        eventId: "counterexample-event",
        role: "counterexample",
        entityId: null,
        simRunId: null,
        fishIndex: null,
        turnIndex: null,
        embeddingId: null,
        occurredAt: "2026-04-27T10:00:00.000Z",
      },
    ]);
  });

  it("adds reviewable visibility only when audit mode is explicit", async () => {
    const listForMemory = vi.fn(async () => []);
    const service = new TemporalMemoryService({
      patternRepo: { listForMemory },
    });

    await service.queryPatterns({ includeAuditOnly: true, limit: 999 });

    expect(listForMemory).toHaveBeenCalledWith({
      statuses: ["accepted", "reviewable"],
      terminalStatus: undefined,
      sourceDomain: undefined,
      limit: 50,
    } satisfies ListTemporalPatternsForMemoryInput);
  });
});

function memoryRow(): TemporalPatternMemoryRepositoryRow {
  return {
    hypothesis: {
      id: 10n,
      patternHash: "pattern-hash-1",
      patternVersion: "temporal-v0.2.0",
      status: "accepted",
      sourceDomain: "production",
      terminalStatus: "timeout",
      patternWindowMs: 900_000,
      patternScore: 0.82,
      supportCount: 5,
      negativeSupportCount: 2,
      baselineRate: 0.1,
      lift: 3.2,
      scoreComponentsJson: {
        temporal_weight: 0.9,
        support_factor: 1,
        lift_factor: 0.8,
        negative_penalty: 0.7,
        stability_factor: 1,
      },
      createdFromLearningRunId: 700n,
      createdAt,
      updatedAt: createdAt,
    },
    steps: [
      {
        id: 20n,
        patternId: 10n,
        stepIndex: 0,
        eventSignature: "fish.high_uncertainty|fish|none|none",
        eventType: "fish.high_uncertainty",
        eventSource: "fish",
        avgDeltaMs: 200,
        supportCount: 5,
      },
    ],
    examples: [
      {
        id: 30n,
        patternId: 10n,
        eventId: "positive-event",
        role: "positive",
        entityId: "sim_swarm:23",
        simRunId: 77n,
        fishIndex: 1,
        turnIndex: 2,
        embeddingId: "embedding-1",
        occurredAt: createdAt,
      },
      {
        id: 31n,
        patternId: 10n,
        eventId: "counterexample-event",
        role: "counterexample",
        entityId: null,
        simRunId: null,
        fishIndex: null,
        turnIndex: null,
        embeddingId: null,
        occurredAt: createdAt,
      },
    ],
  };
}

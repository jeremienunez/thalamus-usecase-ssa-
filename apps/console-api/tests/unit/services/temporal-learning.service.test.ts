import { describe, expect, it, vi } from "vitest";
import type { STDPParams } from "@interview/temporal";
import {
  TemporalLearningService,
  type TemporalLearningServiceDeps,
} from "../../../src/services/temporal-learning.service";
import type {
  PersistTemporalPatternsInput,
  TemporalEventRow,
  TemporalLearningRunRow,
} from "../../../src/types/temporal.types";

const from = new Date("2026-04-27T10:00:00Z");
const to = new Date("2026-04-27T11:00:00Z");
const params: STDPParams = {
  pattern_window_ms: 1_000,
  pre_trace_decay_ms: 1_000,
  learning_rate: 0.1,
  activation_threshold: 0.25,
  min_support: 2,
  max_steps: 2,
  pattern_version: "temporal-v0.2.0",
};
const learningRun: TemporalLearningRunRow = {
  id: 700n,
  patternVersion: params.pattern_version,
  sourceDomain: "simulation",
  inputSnapshotHash: "created-by-service",
  paramsJson: { ...params },
  status: "running",
  metricsJson: {},
  startedAt: from,
  completedAt: null,
};

describe("TemporalLearningService", () => {
  it("completes learning runs after persisting mined temporal hypotheses", async () => {
    let persistedInput: PersistTemporalPatternsInput | null = null;
    const events = [
      ...positiveEpisode("first", new Date("2026-04-27T10:10:00Z")),
      ...positiveEpisode("second", new Date("2026-04-27T10:20:00Z")),
    ];
    const deps = makeDeps({
      events,
      persistLearningPatterns: async (input) => {
        persistedInput = input;
        return input.patterns.map((pattern, index) => ({
          id: BigInt(index + 1),
          patternHash: pattern.pattern_hash,
          patternVersion: pattern.pattern_version,
          status: pattern.status,
        }));
      },
    });
    const service = new TemporalLearningService(deps);

    const summary = await service.runClosedWindowLearning({
      from,
      to,
      sourceDomain: "simulation",
      params,
      targetOutcomes: ["timeout"],
    });

    expect(deps.eventRepo.listForLearningWindow).toHaveBeenCalledWith({
      from,
      to,
      sourceDomain: "simulation",
    });
    expect(summary).toMatchObject({
      learningRunId: 700n,
      sourceDomain: "simulation",
      eventCount: events.length,
    });
    expect(summary.inputSnapshotHash).toHaveLength(64);
    expect(summary.patternCount).toBeGreaterThan(0);
    expect(summary.persistedPatternCount).toBe(summary.patternCount);
    expect(persistedInput?.learningRunId).toBe(700n);
    expect(persistedInput?.eventsById.size).toBe(events.length);
    expect(persistedInput?.patterns[0]).toMatchObject({
      pattern_version: params.pattern_version,
      source_domain: "simulation",
      terminal_status: "timeout",
      status: "candidate",
      support_count: 2,
      hypothesis: true,
      decisionAuthority: false,
    });
    expect(deps.learningRunRepo.complete).toHaveBeenCalledWith(
      700n,
      expect.objectContaining({
        eventCount: events.length,
        patternCount: summary.patternCount,
        persistedPatternCount: summary.persistedPatternCount,
      }),
    );
    expect(deps.learningRunRepo.fail).not.toHaveBeenCalled();
  });

  it("marks the learning run failed when pattern persistence rejects", async () => {
    const deps = makeDeps({
      events: [
        ...positiveEpisode("first", new Date("2026-04-27T10:10:00Z")),
        ...positiveEpisode("second", new Date("2026-04-27T10:20:00Z")),
      ],
      persistLearningPatterns: async () => {
        throw new Error("pattern persistence failed");
      },
    });
    const service = new TemporalLearningService(deps);

    await expect(
      service.runClosedWindowLearning({
        from,
        to,
        sourceDomain: "simulation",
        params,
        targetOutcomes: ["timeout"],
      }),
    ).rejects.toThrow("pattern persistence failed");
    expect(deps.learningRunRepo.fail).toHaveBeenCalledWith(
      700n,
      expect.objectContaining({ error: "pattern persistence failed" }),
    );
    expect(deps.learningRunRepo.complete).not.toHaveBeenCalled();
  });

  it("rejects inverted learning windows before reading temporal events", async () => {
    const deps = makeDeps({ events: [] });
    const service = new TemporalLearningService(deps);

    await expect(
      service.runClosedWindowLearning({
        from: to,
        to: from,
        sourceDomain: "simulation",
        params,
        targetOutcomes: ["timeout"],
      }),
    ).rejects.toThrow("from < to");
    expect(deps.eventRepo.listForLearningWindow).not.toHaveBeenCalled();
    expect(deps.learningRunRepo.create).not.toHaveBeenCalled();
  });
});

function makeDeps(input: {
  events: TemporalEventRow[];
  persistLearningPatterns?: (
    input: PersistTemporalPatternsInput,
  ) => Promise<
    Awaited<ReturnType<TemporalLearningServiceDeps["patternRepo"]["persistLearningPatterns"]>>
  >;
}): TemporalLearningServiceDeps {
  return {
    eventRepo: {
      listForLearningWindow: vi.fn(async () => input.events),
    },
    learningRunRepo: {
      create: vi.fn(async () => learningRun),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    },
    patternRepo: {
      persistLearningPatterns: vi.fn(
        input.persistLearningPatterns ??
          (async (persistInput: PersistTemporalPatternsInput) =>
            persistInput.patterns.map((pattern, index: number) => ({
              id: BigInt(index + 1),
              patternHash: pattern.pattern_hash,
              patternVersion: pattern.pattern_version,
              status: pattern.status,
            }))),
      ),
    },
  };
}

function positiveEpisode(prefix: string, outcomeAt: Date): TemporalEventRow[] {
  return [
    temporalEventRow({
      id: `${prefix}-uncertainty`,
      eventType: "fish.high_uncertainty",
      eventSource: "fish",
      occurredAt: new Date(outcomeAt.getTime() - 200),
      sourcePk: `${prefix}:uncertainty`,
    }),
    temporalEventRow({
      id: `${prefix}-missing-rv`,
      eventType: "review.missing_relative_velocity",
      eventSource: "review",
      occurredAt: new Date(outcomeAt.getTime() - 100),
      sourcePk: `${prefix}:missing-rv`,
    }),
    temporalEventRow({
      id: `${prefix}-timeout`,
      eventType: "outcome.timeout",
      eventSource: "outcome",
      occurredAt: outcomeAt,
      terminalStatus: "timeout",
      sourcePk: `${prefix}:timeout`,
    }),
  ];
}

function temporalEventRow(
  input: Partial<TemporalEventRow> & {
    id: string;
    eventType: string;
    eventSource: string;
    occurredAt: Date;
    sourcePk: string;
  },
): TemporalEventRow {
  return {
    id: input.id,
    projectionRunId: 900n,
    eventType: input.eventType,
    eventSource: input.eventSource,
    entityId: input.entityId ?? "sim_swarm:23",
    simRunId: input.simRunId ?? 10n,
    fishIndex: input.fishIndex ?? 7,
    turnIndex: input.turnIndex ?? null,
    occurredAt: input.occurredAt,
    agentId: input.agentId ?? null,
    actionKind: input.actionKind ?? null,
    confidenceBefore: input.confidenceBefore ?? null,
    confidenceAfter: input.confidenceAfter ?? null,
    reviewOutcome: input.reviewOutcome ?? null,
    terminalStatus: input.terminalStatus ?? null,
    embeddingId: input.embeddingId ?? null,
    seededByPatternId: input.seededByPatternId ?? null,
    sourceDomain: input.sourceDomain ?? "simulation",
    canonicalSignature:
      input.canonicalSignature ??
      `${input.eventType}|${input.eventSource}|none|${input.terminalStatus ?? "none"}`,
    sourceTable: input.sourceTable ?? "fixture",
    sourcePk: input.sourcePk,
    payloadHash: input.payloadHash ?? `payload:${input.id}`,
    metadataJson: input.metadataJson ?? {},
    createdAt: input.createdAt ?? from,
  };
}

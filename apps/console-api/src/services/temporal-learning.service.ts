import { createHash } from "node:crypto";
import {
  learnTemporalPatterns,
  type TemporalEvent as CoreTemporalEvent,
} from "@interview/temporal";
import type {
  CreateTemporalLearningRunInput,
  ListTemporalEventsForLearningInput,
  PersistedTemporalPatternRow,
  PersistTemporalPatternsInput,
  RunTemporalLearningInput,
  TemporalEventRow,
  TemporalLearningRunRow,
  TemporalLearningSummary,
} from "../types/temporal.types";

export interface TemporalLearningServiceDeps {
  eventRepo: {
    listForLearningWindow(
      input: ListTemporalEventsForLearningInput,
    ): Promise<TemporalEventRow[]>;
  };
  learningRunRepo: {
    create(input: CreateTemporalLearningRunInput): Promise<TemporalLearningRunRow>;
    complete(
      learningRunId: bigint,
      metricsJson: Record<string, unknown>,
    ): Promise<void>;
    fail(learningRunId: bigint, metricsJson: Record<string, unknown>): Promise<void>;
  };
  patternRepo: {
    persistLearningPatterns(
      input: PersistTemporalPatternsInput,
    ): Promise<PersistedTemporalPatternRow[]>;
  };
}

export class TemporalLearningService {
  constructor(private readonly deps: TemporalLearningServiceDeps) {}

  async runClosedWindowLearning(
    input: RunTemporalLearningInput,
  ): Promise<TemporalLearningSummary> {
    assertLearningInput(input);
    const events = await this.deps.eventRepo.listForLearningWindow({
      from: input.from,
      to: input.to,
      sourceDomain: input.sourceDomain,
    });
    const inputSnapshotHash = hashJson({
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      sourceDomain: input.sourceDomain,
      params: input.params,
      targetOutcomes: input.targetOutcomes ?? null,
      eventIds: events.map((event) => event.id),
    });
    const learningRun = await this.deps.learningRunRepo.create({
      patternVersion: input.params.pattern_version,
      sourceDomain: input.sourceDomain,
      inputSnapshotHash,
      paramsJson: stdpParamsJson(input.params),
      status: "running",
    });

    try {
      const patterns = learnTemporalPatterns({
        events: events.map(toCoreTemporalEvent),
        params: input.params,
        source_domain: input.sourceDomain,
        target_outcomes: input.targetOutcomes,
      });
      const persisted = await this.deps.patternRepo.persistLearningPatterns({
        learningRunId: learningRun.id,
        patterns,
        eventsById: new Map(events.map((event) => [event.id, event])),
      });
      const summary: TemporalLearningSummary = {
        learningRunId: learningRun.id,
        sourceDomain: input.sourceDomain,
        inputSnapshotHash,
        eventCount: events.length,
        patternCount: patterns.length,
        persistedPatternCount: persisted.length,
      };
      await this.deps.learningRunRepo.complete(learningRun.id, {
        eventCount: summary.eventCount,
        patternCount: summary.patternCount,
        persistedPatternCount: summary.persistedPatternCount,
      });
      return summary;
    } catch (err) {
      await this.deps.learningRunRepo.fail(learningRun.id, {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

function toCoreTemporalEvent(row: TemporalEventRow): CoreTemporalEvent {
  return {
    id: row.id,
    projection_run_id: String(row.projectionRunId),
    event_type: row.eventType,
    event_source: row.eventSource,
    entity_id: row.entityId ?? undefined,
    sim_run_id: row.simRunId?.toString(),
    fish_index: row.fishIndex ?? undefined,
    turn_index: row.turnIndex ?? undefined,
    timestamp: row.occurredAt.getTime(),
    agent_id: row.agentId ?? undefined,
    action_kind: row.actionKind ?? undefined,
    confidence_before: row.confidenceBefore ?? undefined,
    confidence_after: row.confidenceAfter ?? undefined,
    review_outcome: row.reviewOutcome ?? undefined,
    terminal_status: row.terminalStatus ?? undefined,
    embedding_id: row.embeddingId ?? undefined,
    seeded_by_pattern_id: row.seededByPatternId ?? undefined,
    source_domain: row.sourceDomain,
    canonical_signature: row.canonicalSignature,
    source_table: row.sourceTable,
    source_pk: row.sourcePk,
    payload_hash: row.payloadHash,
    metadata: row.metadataJson,
  };
}

type ClosedLearningInput = RunTemporalLearningInput & {
  sourceDomain: Exclude<RunTemporalLearningInput["sourceDomain"], "mixed">;
};

function assertLearningInput(
  input: RunTemporalLearningInput,
): asserts input is ClosedLearningInput {
  if (!Number.isFinite(input.from.getTime()) || !Number.isFinite(input.to.getTime())) {
    throw new Error("temporal learning window requires valid dates");
  }
  if (input.from.getTime() >= input.to.getTime()) {
    throw new Error("temporal learning window requires from < to");
  }
  if (input.sourceDomain === "mixed") {
    throw new Error("temporal learning does not learn mixed domains directly");
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stdpParamsJson(params: RunTemporalLearningInput["params"]): Record<string, unknown> {
  return {
    pattern_window_ms: params.pattern_window_ms,
    pre_trace_decay_ms: params.pre_trace_decay_ms,
    learning_rate: params.learning_rate,
    activation_threshold: params.activation_threshold,
    min_support: params.min_support,
    max_steps: params.max_steps,
    pattern_version: params.pattern_version,
  };
}

function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value != null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
}

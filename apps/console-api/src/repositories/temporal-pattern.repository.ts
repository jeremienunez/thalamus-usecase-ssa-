import { and, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import {
  temporalPatternEdge,
  temporalPatternExample,
  temporalPatternHypothesis,
  temporalPatternStep,
  type NewTemporalPatternEdge,
  type NewTemporalPatternExample,
  type NewTemporalPatternHypothesis,
  type NewTemporalPatternStep,
} from "@interview/db-schema";
import type {
  ListTemporalPatternsForMemoryInput,
  PersistedTemporalPatternRow,
  PersistTemporalPatternsInput,
  TemporalEventRow,
  TemporalPatternMemoryRepositoryRow,
} from "../types/temporal.types";

export class TemporalPatternRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async persistLearningPatterns(
    input: PersistTemporalPatternsInput,
  ): Promise<PersistedTemporalPatternRow[]> {
    const persisted: PersistedTemporalPatternRow[] = [];

    for (const pattern of input.patterns) {
      const row: NewTemporalPatternHypothesis = {
        patternHash: pattern.pattern_hash,
        patternVersion: pattern.pattern_version,
        status: pattern.status,
        sourceDomain: pattern.source_domain,
        terminalStatus: pattern.terminal_status,
        patternWindowMs: pattern.pattern_window_ms,
        patternScore: pattern.pattern_score,
        supportCount: pattern.support_count,
        negativeSupportCount: pattern.negative_support_count,
        baselineRate: pattern.baseline_rate,
        lift: pattern.lift,
        scoreComponentsJson: pattern.score_components,
        createdFromLearningRunId: input.learningRunId,
      };
      const [inserted] = await this.db
        .insert(temporalPatternHypothesis)
        .values(row)
        .onConflictDoNothing()
        .returning();
      const hypothesis =
        inserted ??
        (await this.findByHashVersion(pattern.pattern_hash, pattern.pattern_version));
      if (!hypothesis) {
        throw new Error(`temporal pattern ${pattern.pattern_hash} was not persisted`);
      }

      await this.insertSteps(hypothesis.id, pattern.sequence);
      await this.insertEdges(hypothesis.id, pattern.sequence, pattern.pattern_score);
      await this.insertExamples({
        patternId: hypothesis.id,
        exampleEventIds: pattern.example_event_ids,
        counterexampleEventIds: pattern.counterexample_event_ids,
        eventsById: input.eventsById,
      });

      persisted.push({
        id: hypothesis.id,
        patternHash: hypothesis.patternHash,
        patternVersion: hypothesis.patternVersion,
        status: hypothesis.status,
      });
    }

    return persisted;
  }

  async listForMemory(
    input: ListTemporalPatternsForMemoryInput,
  ): Promise<TemporalPatternMemoryRepositoryRow[]> {
    const conditions = [inArray(temporalPatternHypothesis.status, input.statuses)];
    if (input.terminalStatus) {
      conditions.push(
        eq(temporalPatternHypothesis.terminalStatus, input.terminalStatus),
      );
    }
    if (input.sourceDomain) {
      conditions.push(eq(temporalPatternHypothesis.sourceDomain, input.sourceDomain));
    }

    const hypotheses = await this.db
      .select()
      .from(temporalPatternHypothesis)
      .where(and(...conditions))
      .orderBy(
        desc(temporalPatternHypothesis.patternScore),
        desc(temporalPatternHypothesis.updatedAt),
        desc(temporalPatternHypothesis.id),
      )
      .limit(input.limit);
    if (hypotheses.length === 0) return [];

    const patternIds = hypotheses.map((hypothesis) => hypothesis.id);
    const [steps, examples] = await Promise.all([
      this.db
        .select()
        .from(temporalPatternStep)
        .where(inArray(temporalPatternStep.patternId, patternIds))
        .orderBy(temporalPatternStep.patternId, temporalPatternStep.stepIndex),
      this.db
        .select()
        .from(temporalPatternExample)
        .where(inArray(temporalPatternExample.patternId, patternIds))
        .orderBy(
          temporalPatternExample.patternId,
          temporalPatternExample.occurredAt,
          temporalPatternExample.eventId,
        ),
    ]);
    const stepsByPatternId = groupByPatternId(steps);
    const examplesByPatternId = groupByPatternId(examples);

    return hypotheses.map((hypothesis) => {
      const key = hypothesis.id.toString();
      return {
        hypothesis,
        steps: stepsByPatternId.get(key) ?? [],
        examples: examplesByPatternId.get(key) ?? [],
      };
    });
  }

  private async findByHashVersion(patternHash: string, patternVersion: string) {
    const [existing] = await this.db
      .select()
      .from(temporalPatternHypothesis)
      .where(
        and(
          eq(temporalPatternHypothesis.patternHash, patternHash),
          eq(temporalPatternHypothesis.patternVersion, patternVersion),
        ),
      )
      .limit(1);
    return existing ?? null;
  }

  private async insertSteps(
    patternId: bigint,
    sequence: PersistTemporalPatternsInput["patterns"][number]["sequence"],
  ): Promise<void> {
    if (sequence.length === 0) return;
    const rows: NewTemporalPatternStep[] = sequence.map((step) => {
      const { eventType, eventSource } = parseSignature(step.event_signature);
      return {
        patternId,
        stepIndex: step.step_index,
        eventSignature: step.event_signature,
        eventType,
        eventSource,
        avgDeltaMs: step.avg_delta_ms,
        supportCount: step.support_count,
      };
    });
    await this.db
      .insert(temporalPatternStep)
      .values(rows)
      .onConflictDoNothing();
  }

  private async insertEdges(
    patternId: bigint,
    sequence: PersistTemporalPatternsInput["patterns"][number]["sequence"],
    patternScore: number,
  ): Promise<void> {
    if (sequence.length < 2) return;
    const rows: NewTemporalPatternEdge[] = [];
    for (let index = 1; index < sequence.length; index += 1) {
      const previous = sequence[index - 1]!;
      const current = sequence[index]!;
      rows.push({
        patternId,
        fromSignature: previous.event_signature,
        toSignature: current.event_signature,
        weight: patternScore,
        supportCount: current.support_count,
        avgDeltaMs: Math.max(0, previous.avg_delta_ms - current.avg_delta_ms),
      });
    }
    await this.db
      .insert(temporalPatternEdge)
      .values(rows)
      .onConflictDoNothing();
  }

  private async insertExamples(input: {
    patternId: bigint;
    exampleEventIds: string[];
    counterexampleEventIds: string[];
    eventsById: Map<string, TemporalEventRow>;
  }): Promise<void> {
    const rows: NewTemporalPatternExample[] = [
      ...input.exampleEventIds.flatMap((eventId) =>
        toExampleRow(input.patternId, input.eventsById.get(eventId), "positive"),
      ),
      ...input.counterexampleEventIds.flatMap((eventId) =>
        toExampleRow(input.patternId, input.eventsById.get(eventId), "counterexample"),
      ),
    ];
    if (rows.length === 0) return;
    await this.db
      .insert(temporalPatternExample)
      .values(rows)
      .onConflictDoNothing();
  }
}

function toExampleRow(
  patternId: bigint,
  event: TemporalEventRow | undefined,
  role: "positive" | "counterexample",
): NewTemporalPatternExample[] {
  if (!event) return [];
  return [
    {
      patternId,
      eventId: event.id,
      role,
      entityId: event.entityId ?? null,
      simRunId: event.simRunId ?? null,
      fishIndex: event.fishIndex ?? null,
      turnIndex: event.turnIndex ?? null,
      embeddingId: event.embeddingId ?? null,
      occurredAt: event.occurredAt,
    },
  ];
}

function parseSignature(signature: string): {
  eventType: string;
  eventSource: string;
} {
  const [eventType, eventSource] = signature.split("|");
  return {
    eventType: eventType || "unknown",
    eventSource: eventSource || "unknown",
  };
}

function groupByPatternId<T extends { patternId: bigint }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.patternId.toString();
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }
  return grouped;
}

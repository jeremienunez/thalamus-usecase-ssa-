import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import { temporalEvent, type NewTemporalEvent } from "@interview/db-schema";
import type {
  InsertTemporalEventInput,
  ListTemporalEventsForLearningInput,
  TemporalEventRow,
} from "../types/temporal.types";

export class TemporalEventRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async insertMany(inputs: InsertTemporalEventInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const rows: NewTemporalEvent[] = inputs.map((input) => ({
      id: input.id,
      projectionRunId: input.projectionRunId,
      eventType: input.eventType,
      eventSource: input.eventSource,
      entityId: input.entityId ?? null,
      simRunId: input.simRunId ?? null,
      fishIndex: input.fishIndex ?? null,
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
      sourceDomain: input.sourceDomain,
      canonicalSignature: input.canonicalSignature,
      sourceTable: input.sourceTable,
      sourcePk: input.sourcePk,
      payloadHash: input.payloadHash,
      metadataJson: input.metadataJson ?? {},
    }));
    const inserted = await this.db
      .insert(temporalEvent)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: temporalEvent.id });
    return inserted.length;
  }

  async listForLearningWindow(
    input: ListTemporalEventsForLearningInput,
  ): Promise<TemporalEventRow[]> {
    const rows = await this.db
      .select()
      .from(temporalEvent)
      .where(
        and(
          eq(temporalEvent.sourceDomain, input.sourceDomain),
          gte(temporalEvent.occurredAt, input.from),
          lt(temporalEvent.occurredAt, input.to),
        ),
      )
      .orderBy(asc(temporalEvent.occurredAt), asc(temporalEvent.id));
    return rows.map(toTemporalEventRow);
  }
}

export function toTemporalEventRow(
  row: typeof temporalEvent.$inferSelect,
): TemporalEventRow {
  return {
    id: row.id,
    projectionRunId: row.projectionRunId,
    eventType: row.eventType,
    eventSource: row.eventSource,
    entityId: row.entityId,
    simRunId: row.simRunId,
    fishIndex: row.fishIndex,
    turnIndex: row.turnIndex,
    occurredAt: row.occurredAt,
    agentId: row.agentId,
    actionKind: row.actionKind,
    confidenceBefore: row.confidenceBefore,
    confidenceAfter: row.confidenceAfter,
    reviewOutcome: row.reviewOutcome,
    terminalStatus: row.terminalStatus,
    embeddingId: row.embeddingId,
    seededByPatternId: row.seededByPatternId,
    sourceDomain: row.sourceDomain,
    canonicalSignature: row.canonicalSignature,
    sourceTable: row.sourceTable,
    sourcePk: row.sourcePk,
    payloadHash: row.payloadHash,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt,
  };
}

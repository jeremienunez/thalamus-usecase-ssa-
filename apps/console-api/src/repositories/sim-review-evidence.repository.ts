import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import { simReviewEvidence, type NewSimReviewEvidence } from "@interview/db-schema";
import type {
  InsertSimReviewEvidenceInput,
  SimReviewEvidenceRow,
} from "../types/sim-review-evidence.types";

export type { InsertSimReviewEvidenceInput, SimReviewEvidenceRow };

export class SimReviewEvidenceRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async insert(input: InsertSimReviewEvidenceInput): Promise<SimReviewEvidenceRow> {
    const row: NewSimReviewEvidence = {
      swarmId: input.swarmId,
      simRunId: input.simRunId ?? null,
      scope: input.scope,
      question: input.question,
      answer: input.answer,
      evidenceRefs: input.evidenceRefs,
      traceExcerpt: input.traceExcerpt,
      createdBy: input.createdBy ?? null,
    };
    const [inserted] = await this.db
      .insert(simReviewEvidence)
      .values(row)
      .returning();
    if (!inserted) throw new Error("insert sim_review_evidence returned no row");
    return toRow(inserted);
  }

  async listForSwarm(swarmId: bigint): Promise<SimReviewEvidenceRow[]> {
    const rows = await this.db
      .select()
      .from(simReviewEvidence)
      .where(eq(simReviewEvidence.swarmId, swarmId))
      .orderBy(asc(simReviewEvidence.createdAt), asc(simReviewEvidence.id));
    return rows.map(toRow);
  }

  async listCreatedBetween(from: Date, to: Date): Promise<SimReviewEvidenceRow[]> {
    const rows = await this.db
      .select()
      .from(simReviewEvidence)
      .where(
        and(
          gte(simReviewEvidence.createdAt, from),
          lt(simReviewEvidence.createdAt, to),
        ),
      )
      .orderBy(asc(simReviewEvidence.createdAt), asc(simReviewEvidence.id));
    return rows.map(toRow);
  }
}

function toRow(row: typeof simReviewEvidence.$inferSelect): SimReviewEvidenceRow {
  return {
    id: row.id,
    swarmId: row.swarmId,
    simRunId: row.simRunId,
    scope: row.scope,
    question: row.question,
    answer: row.answer,
    evidenceRefs: row.evidenceRefs,
    traceExcerpt: row.traceExcerpt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

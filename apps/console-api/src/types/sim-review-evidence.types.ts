import type { SimReviewScope } from "@interview/db-schema";

export interface SimReviewEvidenceRow {
  id: bigint;
  swarmId: bigint;
  simRunId: bigint | null;
  scope: SimReviewScope;
  question: string;
  answer: string;
  evidenceRefs: Array<Record<string, unknown>>;
  traceExcerpt: Record<string, unknown>;
  createdBy: bigint | null;
  createdAt: Date;
}

export interface InsertSimReviewEvidenceInput {
  swarmId: bigint;
  simRunId?: bigint | null;
  scope: SimReviewScope;
  question: string;
  answer: string;
  evidenceRefs: Array<Record<string, unknown>>;
  traceExcerpt: Record<string, unknown>;
  createdBy?: bigint | null;
}

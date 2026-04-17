/**
 * Research Entity Types — Drizzle ORM inferred shapes.
 *
 * These are the raw row types used by the repository layer to talk to
 * Postgres. Services and ports must NOT import from here — they use
 * the public DTOs in `../types/research.types`.
 */

import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import type {
  researchCycle,
  researchFinding,
  researchEdge,
} from "@interview/db-schema";

export type ResearchCycleEntity = InferSelectModel<typeof researchCycle>;
export type NewResearchCycleEntity = InferInsertModel<typeof researchCycle>;

export type ResearchFindingEntity = InferSelectModel<typeof researchFinding>;
export type NewResearchFindingEntity = InferInsertModel<typeof researchFinding>;

export type ResearchEdgeEntity = InferSelectModel<typeof researchEdge>;
export type NewResearchEdgeEntity = InferInsertModel<typeof researchEdge>;

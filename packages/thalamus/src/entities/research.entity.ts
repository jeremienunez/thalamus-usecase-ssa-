/**
 * Research Entity Types — Thalamus knowledge graph
 * Inferred from Drizzle schema
 */

import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import type {
  researchCycle,
  researchFinding,
  researchEdge,
} from "@interview/db-schema";

export type ResearchCycle = InferSelectModel<typeof researchCycle>;
export type NewResearchCycle = InferInsertModel<typeof researchCycle>;

export type ResearchFinding = InferSelectModel<typeof researchFinding>;
export type NewResearchFinding = InferInsertModel<typeof researchFinding>;

export type ResearchEdge = InferSelectModel<typeof researchEdge>;
export type NewResearchEdge = InferInsertModel<typeof researchEdge>;

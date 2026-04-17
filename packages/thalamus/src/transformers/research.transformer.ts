/**
 * Research transformer — entity (Drizzle row) → DTO (public type).
 *
 * Drizzle infers enum columns as `string`. Our DTOs narrow them to the
 * shared `Research*` enum types. The shapes are otherwise identical.
 */

import type {
  ResearchCycleEntity,
  ResearchFindingEntity,
  ResearchEdgeEntity,
} from "../entities/research.entity";
import type {
  ResearchCycle,
  ResearchFinding,
  ResearchEdge,
} from "../types/research.types";

export function toResearchCycle(row: ResearchCycleEntity): ResearchCycle {
  return row as unknown as ResearchCycle;
}

export function toResearchFinding(row: ResearchFindingEntity): ResearchFinding {
  return row as unknown as ResearchFinding;
}

export function toResearchEdge(row: ResearchEdgeEntity): ResearchEdge {
  return row as unknown as ResearchEdge;
}

/**
 * Research transformer — entity (Drizzle row) → DTO (public type).
 *
 * Drizzle infers enum columns as `string`. Our DTOs narrow them to the
 * shared `Research*` enum types. The shapes are otherwise identical.
 *
 * Naming note — `extensions` vs `bus_context`:
 * the DB column is `bus_context` (historical SSA-era name), but the
 * Drizzle schema aliases the JS-side property to `extensions` (see
 * `packages/db-schema/src/schema/research.ts`). Both the entity (inferred
 * from Drizzle) and the DTO therefore carry `extensions` — no manual
 * column rename is needed here. Kept as a single `as unknown as`
 * passthrough.
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

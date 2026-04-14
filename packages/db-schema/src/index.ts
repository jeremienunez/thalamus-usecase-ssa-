/**
 * @interview/db-schema — single source of truth for entity shapes, enums, and
 * Drizzle tables consumed by @interview/thalamus and @interview/sweep.
 *
 * Export surface:
 *   - tables           (satellite, researchFinding, …)
 *   - inferred types   (Satellite, ResearchFinding, NewResearchFinding, …)
 *   - pgEnums          (cortexEnum, findingTypeEnum, …)
 *   - Database         (typed NodePgDatabase<typeof schema>)
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export * from "./schema";
export * from "./enums";

import {
  pgTable,
  bigserial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Launch — a launch event / campaign record.
 *
 * Referenced polymorphically by researchEdge.entity_type = 'launch' and by
 * [entity-name-resolver.ts](../../../thalamus/src/repositories/entity-name-resolver.ts)
 * which uses `year` as the node label for the knowledge graph UI. Kept minimal
 * for now — enrich (vehicle, site, outcome, payloads[]) when a cortex starts
 * writing launches.
 */
export const launch = pgTable("launch", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  year: integer("year").notNull(),
  name: text("name"),
  vehicle: text("vehicle"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Launch = typeof launch.$inferSelect;
export type NewLaunch = typeof launch.$inferInsert;

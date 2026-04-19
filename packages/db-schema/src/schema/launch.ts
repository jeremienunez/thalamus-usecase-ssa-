import {
  pgTable,
  bigserial,
  boolean,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Launch — a launch event / campaign record.
 *
 * Referenced polymorphically by researchEdge.entity_type = 'launch' and by
 * the SSA EntityCatalogPort adapter (`apps/console-api/src/agent/ssa/
 * ssa-entity-catalog.adapter.ts`) which uses `year` as the node label for
 * the knowledge graph UI.
 *
 * Enriched in Phase 3c from Launch Library 2 (https://ll.thespacedevs.com)
 * — `externalLaunchId` is LL2's UUID, unique per upcoming launch. Legacy
 * seeded rows (pre-3c) have null externals.
 */
export const launch = pgTable(
  "launch",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    year: integer("year").notNull(),
    name: text("name"),
    vehicle: text("vehicle"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // LL2 enrichment (Phase 3c). All nullable for back-compat with seeded rows.
    externalLaunchId: text("external_launch_id"),
    operatorName: text("operator_name"),
    operatorCountry: text("operator_country"),
    padName: text("pad_name"),
    padLocation: text("pad_location"),
    plannedNet: timestamp("planned_net", { withTimezone: true }),
    plannedWindowStart: timestamp("planned_window_start", {
      withTimezone: true,
    }),
    plannedWindowEnd: timestamp("planned_window_end", { withTimezone: true }),
    status: text("status"),
    orbitName: text("orbit_name"),
    missionName: text("mission_name"),
    missionDescription: text("mission_description"),
    rideshare: boolean("rideshare"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueExternal: uniqueIndex("uq_launch_external_id").on(t.externalLaunchId),
    padIdx: index("idx_launch_pad").on(t.padName),
    netIdx: index("idx_launch_planned_net").on(t.plannedNet),
  }),
);

export type Launch = typeof launch.$inferSelect;
export type NewLaunch = typeof launch.$inferInsert;

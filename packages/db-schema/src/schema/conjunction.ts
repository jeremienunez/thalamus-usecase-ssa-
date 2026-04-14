import {
  pgTable,
  bigserial,
  bigint,
  timestamp,
  real,
  text,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { satellite } from "./satellite";

/**
 * Conjunction event — SGP4-propagated close approach between two satellites.
 *
 * Produced by `seedConjunctions` in src/seed/conjunctions.ts. Pairs are
 * screened within the same orbital regime over a configurable forward
 * window; only min-range-below-threshold pairs are persisted.
 */
export const conjunctionEvent = pgTable(
  "conjunction_event",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    primarySatelliteId: bigint("primary_satellite_id", { mode: "bigint" })
      .notNull()
      .references(() => satellite.id, { onDelete: "cascade" }),
    secondarySatelliteId: bigint("secondary_satellite_id", { mode: "bigint" })
      .notNull()
      .references(() => satellite.id, { onDelete: "cascade" }),
    epoch: timestamp("epoch", { withTimezone: true }).notNull(),
    minRangeKm: real("min_range_km").notNull(),
    relativeVelocityKmps: real("relative_velocity_kmps"),
    probabilityOfCollision: real("probability_of_collision"),
    primarySigmaKm: real("primary_sigma_km"),
    secondarySigmaKm: real("secondary_sigma_km"),
    combinedSigmaKm: real("combined_sigma_km"),
    hardBodyRadiusM: real("hard_body_radius_m").default(20),
    pcMethod: text("pc_method"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata"),
  },
  (t) => ({
    epochIdx: index("idx_conjunction_epoch").on(t.epoch),
    primaryIdx: index("idx_conjunction_primary").on(
      t.primarySatelliteId,
      t.epoch,
    ),
    rangeIdx: index("idx_conjunction_range").on(t.minRangeKm),
    pcIdx: index("idx_conjunction_pc").on(t.probabilityOfCollision),
    uniquePair: uniqueIndex("uq_conjunction_pair_epoch").on(
      t.primarySatelliteId,
      t.secondarySatelliteId,
      t.epoch,
    ),
  }),
);

export type ConjunctionEvent = typeof conjunctionEvent.$inferSelect;
export type NewConjunctionEvent = typeof conjunctionEvent.$inferInsert;

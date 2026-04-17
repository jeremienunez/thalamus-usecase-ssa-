import {
  pgTable,
  bigserial,
  bigint,
  integer,
  timestamp,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { satellite } from "./satellite";

/**
 * TLE history — time-series of two-line-element snapshots per satellite.
 *
 * Written every 6 h by the `tle-history` ingester (Phase 3a) pulling
 * CelesTrak GP per-group feeds. Consumed by `apogee_tracker` for
 * slope-based apogee/perigee trajectory + decay-regime classification.
 *
 * `(satellite_id, epoch)` is unique — repeated fetches of the same TLE
 * are idempotent via `ON CONFLICT DO NOTHING`.
 */
export const tleHistory = pgTable(
  "tle_history",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    satelliteId: bigint("satellite_id", { mode: "bigint" })
      .notNull()
      .references(() => satellite.id, { onDelete: "cascade" }),
    noradId: integer("norad_id").notNull(),
    epoch: timestamp("epoch", { withTimezone: true }).notNull(),
    meanMotion: real("mean_motion").notNull(),
    eccentricity: real("eccentricity").notNull(),
    inclinationDeg: real("inclination_deg").notNull(),
    raan: real("raan"),
    argOfPerigee: real("arg_of_perigee"),
    meanAnomaly: real("mean_anomaly"),
    bstar: real("bstar"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueEpoch: uniqueIndex("uq_tle_history_sat_epoch").on(
      t.satelliteId,
      t.epoch,
    ),
    satEpochIdx: index("idx_tle_history_sat_epoch").on(
      t.satelliteId,
      t.epoch,
    ),
    noradIdx: index("idx_tle_history_norad").on(t.noradId),
  }),
);

export type TleHistory = typeof tleHistory.$inferSelect;
export type NewTleHistory = typeof tleHistory.$inferInsert;

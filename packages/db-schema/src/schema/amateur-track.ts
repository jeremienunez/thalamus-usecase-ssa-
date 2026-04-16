import {
  pgTable,
  bigserial,
  bigint,
  integer,
  text,
  timestamp,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { source } from "./source";
import { satellite, orbitRegime } from "./satellite";

/**
 * Amateur tracker observation — SeeSat-L, SatTrackCam, Jonathan's Space Report,
 * Space-Track catalog diffs. Each row is one observation attributable to a
 * public amateur source. The OpacityScout cortex consumes this table to fuse
 * amateur OSINT with the official catalog and derive `satellite.opacity_score`.
 *
 * Matching strategy:
 *   - `candidate_norad_id` / `candidate_cospar` carry whatever ID the observer
 *     reported (may be null for unidentified targets).
 *   - The scout resolver fills `resolved_satellite_id` + `match_confidence`
 *     once it correlates the observation to a satellite row (or leaves them
 *     null to preserve the "unresolved" state for reviewer inspection).
 *
 * Provenance:
 *   - `citation_url` is mandatory — OpacityScout findings inherit this as
 *     evidence. `raw_excerpt` keeps the exact text the reviewer will see.
 */
export const amateurTrack = pgTable(
  "amateur_track",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    sourceId: bigint("source_id", { mode: "bigint" })
      .notNull()
      .references(() => source.id),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    candidateNoradId: integer("candidate_norad_id"),
    candidateCospar: text("candidate_cospar"),
    tleLine1: text("tle_line_1"),
    tleLine2: text("tle_line_2"),
    orbitRegimeId: bigint("orbit_regime_id", { mode: "bigint" }).references(
      () => orbitRegime.id,
    ),
    observerHandle: text("observer_handle"),
    citationUrl: text("citation_url").notNull(),
    rawExcerpt: text("raw_excerpt"),
    resolvedSatelliteId: bigint("resolved_satellite_id", {
      mode: "bigint",
    }).references(() => satellite.id),
    matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    noradIdx: index("idx_amateur_track_norad")
      .on(t.candidateNoradId)
      .where(sql`candidate_norad_id IS NOT NULL`),
    cosparIdx: index("idx_amateur_track_cospar")
      .on(t.candidateCospar)
      .where(sql`candidate_cospar IS NOT NULL`),
    resolvedIdx: index("idx_amateur_track_resolved")
      .on(t.resolvedSatelliteId)
      .where(sql`resolved_satellite_id IS NOT NULL`),
    observedIdx: index("idx_amateur_track_observed").on(t.observedAt),
  }),
);

export type AmateurTrack = typeof amateurTrack.$inferSelect;
export type NewAmateurTrack = typeof amateurTrack.$inferInsert;

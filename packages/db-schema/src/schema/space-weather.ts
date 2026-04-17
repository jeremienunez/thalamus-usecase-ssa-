import {
  pgTable,
  bigserial,
  timestamp,
  real,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Space-weather forecast / nowcast — multi-source by design.
 *
 * Written daily by the `space-weather` ingester (Phase 3b). Three sources:
 *   - `noaa-swpc-27do` — 27-day F10.7 + planetary A + Kp outlook (forecast).
 *   - `gfz-kp`        — GFZ Potsdam Kp index (canonical publisher, 3-hour cadence).
 *   - `sidc-eisn`     — SIDC/STCE sunspot number (EISN), daily observation.
 *
 * Not every source fills every column; nullable where a publisher doesn't
 * emit that datum. `(source, epoch, issued_at)` is unique so re-runs are
 * idempotent and an audit trail is kept when the publisher revises a
 * value. Skills cross-check divergence between sources.
 */
export const spaceWeatherForecast = pgTable(
  "space_weather_forecast",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    epoch: timestamp("epoch", { withTimezone: true }).notNull(),
    f107: real("f107"),
    apIndex: real("ap_index"),
    kpIndex: real("kp_index"),
    sunspotNumber: real("sunspot_number"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueSourceEpochIssue: uniqueIndex("uq_space_weather_src_epoch_issue").on(
      t.source,
      t.epoch,
      t.issuedAt,
    ),
    epochIdx: index("idx_space_weather_epoch").on(t.epoch),
    sourceEpochIdx: index("idx_space_weather_source_epoch").on(
      t.source,
      t.epoch,
    ),
  }),
);

export type SpaceWeatherForecast = typeof spaceWeatherForecast.$inferSelect;
export type NewSpaceWeatherForecast =
  typeof spaceWeatherForecast.$inferInsert;

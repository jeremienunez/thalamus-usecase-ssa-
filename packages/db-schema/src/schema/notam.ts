import {
  pgTable,
  bigserial,
  boolean,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * NOTAM — US Temporary Flight Restrictions (TFRs) from FAA.
 *
 * Source: https://tfr.faa.gov/tfrapi/exportTfrList — public JSON, no auth.
 * Fields are what the FAA's public API actually exposes; no geometry
 * (the API only narrates "18NM NORTH OF DILLON, MT" — geocoding that
 * to a bbox is out of scope for v1). A `SPACE OPERATIONS` type flag
 * pre-classifies launch-hazard TFRs, which is what `launch_scout`
 * actually needs.
 *
 * Parsed timestamps (`parsed_start_utc`, `parsed_end_utc`) come from
 * regexing the `description` narrative — kept separate from the raw
 * `description` field so downstream queries can filter by window.
 */
export const notam = pgTable(
  "notam",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    notamId: text("notam_id").notNull(),
    type: text("type").notNull(),
    facility: text("facility"),
    state: text("state"),
    description: text("description").notNull(),
    creationDate: timestamp("creation_date", { withTimezone: true }),
    parsedStartUtc: timestamp("parsed_start_utc", { withTimezone: true }),
    parsedEndUtc: timestamp("parsed_end_utc", { withTimezone: true }),
    isLaunchRelated: boolean("is_launch_related").notNull().default(false),
    source: text("source").notNull().default("faa-tfr"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueSourceNotam: uniqueIndex("uq_notam_source_id").on(
      t.source,
      t.notamId,
    ),
    launchIdx: index("idx_notam_launch").on(t.isLaunchRelated),
    windowIdx: index("idx_notam_window").on(
      t.parsedStartUtc,
      t.parsedEndUtc,
    ),
  }),
);

export type Notam = typeof notam.$inferSelect;
export type NewNotam = typeof notam.$inferInsert;

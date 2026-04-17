import {
  pgTable,
  bigserial,
  integer,
  real,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Fragmentation event — catalog of historical breakups / collisions / ASAT
 * tests. Seeded from a curated list (`fragmentation-events-fetcher`) because
 * the dataset is small (~30-50 events all-time) and slow-moving. NASA ODPO
 * publishes the authoritative catalog quarterly in PDF/HTML — machine
 * scraping is future work; the hand-curated list covers the major
 * Kessler-relevant events through today.
 *
 * Consumed by `debris_forecaster` as Kessler-density analog citations when
 * the skill flags a congested shell.
 */
export const fragmentationEvent = pgTable(
  "fragmentation_event",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    parentNoradId: integer("parent_norad_id"),
    parentName: text("parent_name").notNull(),
    parentOperatorCountry: text("parent_operator_country"),
    dateUtc: timestamp("date_utc", { withTimezone: true }).notNull(),
    regimeName: text("regime_name"),
    fragmentsCataloged: integer("fragments_cataloged"),
    parentMassKg: real("parent_mass_kg"),
    eventType: text("event_type").notNull(),
    cause: text("cause"),
    sourceUrl: text("source_url"),
    source: text("source").notNull().default("curated"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueParentDate: uniqueIndex("uq_fragmentation_parent_date").on(
      t.parentName,
      t.dateUtc,
    ),
    dateIdx: index("idx_fragmentation_date").on(t.dateUtc),
    regimeIdx: index("idx_fragmentation_regime").on(t.regimeName),
  }),
);

export type FragmentationEvent = typeof fragmentationEvent.$inferSelect;
export type NewFragmentationEvent =
  typeof fragmentationEvent.$inferInsert;

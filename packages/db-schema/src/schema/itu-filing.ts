import {
  pgTable,
  bigserial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * ITU space-network filing — notifications of planned satellite systems
 * filed with the International Telecommunication Union Radiocommunication
 * Bureau (BR-IFIC / SNL). Each filing claims an orbital slot (GSO) or
 * non-GSO constellation envelope with declared frequency bands.
 *
 * Seeded from a curated list of major constellation filings
 * (`itu-filings-fetcher`) — the ITU's public endpoints are HTML-scrape
 * only (no JSON API) and the SNL list pages surface suspensions /
 * bureaucratic records rather than the new-filings pipeline launch_scout
 * needs. The curated list focuses on mega-constellations that matter for
 * SSA planning: Starlink v2 / Kuiper / OneWeb / IRIS² / GW / Qianfan /
 * Lightspeed / etc.
 *
 * Consumed by `launch_scout` to foresee constellations that will hit the
 * catalog once their first birds fly.
 */
export const ituFiling = pgTable(
  "itu_filing",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    filingId: text("filing_id").notNull(),
    constellationName: text("constellation_name").notNull(),
    administration: text("administration").notNull(),
    operatorName: text("operator_name"),
    operatorCountry: text("operator_country"),
    orbitClass: text("orbit_class").notNull(),
    orbitDetails: text("orbit_details"),
    altitudeKm: integer("altitude_km"),
    inclinationDeg: integer("inclination_deg"),
    plannedSatellites: integer("planned_satellites"),
    frequencyBands: text("frequency_bands").array(),
    filingDate: timestamp("filing_date", { withTimezone: true }),
    status: text("status"),
    sourceUrl: text("source_url"),
    raw: jsonb("raw"),
    source: text("source").notNull().default("curated"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueFiling: uniqueIndex("uq_itu_filing_id").on(t.source, t.filingId),
    constellationIdx: index("idx_itu_constellation").on(t.constellationName),
    operatorIdx: index("idx_itu_operator_country").on(t.operatorCountry),
  }),
);

export type ItuFiling = typeof ituFiling.$inferSelect;
export type NewItuFiling = typeof ituFiling.$inferInsert;

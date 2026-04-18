/**
 * Fragmentation events "fetcher" — not actually a fetcher; a curated
 * idempotent seeder for historical on-orbit breakup events. The dataset
 * is small (~30 major events all-time through 2026) and NASA ODPO
 * publishes it quarterly in PDF — machine scraping deferred.
 *
 * Run on demand via `POST /api/ingestion/run/fragmentation-events`.
 * No cron — the list only changes when a new breakup is recognised
 * (~1–2 per year) and the operator updates this file.
 *
 * Sources for each event — NASA ODPO Orbital Debris Quarterly News,
 * Space-Track public SATCAT, ESA DISCOS public summary. Pointers in
 * `sourceUrl` column per row.
 */

import {
  fragmentationEvent,
  type NewFragmentationEvent,
} from "@interview/db-schema";
import type { IngestionSource, IngestionRunContext } from "@interview/sweep";

interface IngestionResult {
  inserted: number;
  skipped: number;
  notes?: string;
}

type Seed = Omit<NewFragmentationEvent, "fetchedAt" | "source"> & {
  dateUtc: Date;
};

// prettier-ignore
const EVENTS: Seed[] = [
  {
    parentNoradId: 25730,
    parentName: "Fengyun-1C",
    parentOperatorCountry: "CN",
    dateUtc: new Date("2007-01-11T00:00:00Z"),
    regimeName: "SSO",
    fragmentsCataloged: 3530,
    parentMassKg: 880,
    eventType: "asat_test",
    cause: "Chinese ASAT SC-19 kinetic intercept at 865 km altitude; largest single debris-creation event to date.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv11i2.pdf",
  },
  {
    parentNoradId: 22675,
    parentName: "Cosmos 2251",
    parentOperatorCountry: "RU",
    dateUtc: new Date("2009-02-10T16:56:00Z"),
    regimeName: "LEO",
    fragmentsCataloged: 1668,
    parentMassKg: 900,
    eventType: "collision",
    cause: "First-ever accidental hypervelocity collision between two intact satellites; defunct Cosmos 2251 struck operational Iridium 33 at 789 km.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv13i2.pdf",
  },
  {
    parentNoradId: 24946,
    parentName: "Iridium 33",
    parentOperatorCountry: "US",
    dateUtc: new Date("2009-02-10T16:56:00Z"),
    regimeName: "LEO",
    fragmentsCataloged: 628,
    parentMassKg: 689,
    eventType: "collision",
    cause: "Operational Iridium LEO comms satellite lost in Iridium 33 × Cosmos 2251 collision at 789 km.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv13i2.pdf",
  },
  {
    parentNoradId: 13552,
    parentName: "Cosmos 1408",
    parentOperatorCountry: "RU",
    dateUtc: new Date("2021-11-15T02:47:00Z"),
    regimeName: "LEO",
    fragmentsCataloged: 1785,
    parentMassKg: 1750,
    eventType: "asat_test",
    cause: "Russian PL-19 Nudol ASAT intercept; forced ISS crew shelter; generated debris cloud in ISS-crossing 480 km shell.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv26i1.pdf",
  },
  {
    parentNoradId: 26536,
    parentName: "NOAA-16",
    parentOperatorCountry: "US",
    dateUtc: new Date("2015-11-25T00:00:00Z"),
    regimeName: "SSO",
    fragmentsCataloged: 458,
    parentMassKg: 1475,
    eventType: "breakup",
    cause: "Thermal runaway / battery failure; fragmented at ~850 km altitude. Pattern repeated across DMSP and NOAA weather-sat series (Long-Life Battery Assembly issue).",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv20i1.pdf",
  },
  {
    parentNoradId: 24753,
    parentName: "DMSP F13",
    parentOperatorCountry: "US",
    dateUtc: new Date("2015-02-03T00:00:00Z"),
    regimeName: "SSO",
    fragmentsCataloged: 234,
    parentMassKg: 830,
    eventType: "breakup",
    cause: "Battery overheating and rupture; same root cause as later NOAA-16. Fragmented at ~800 km SSO.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv19i2.pdf",
  },
  {
    parentNoradId: 54216,
    parentName: "Long March 6A upper stage",
    parentOperatorCountry: "CN",
    dateUtc: new Date("2022-11-12T00:00:00Z"),
    regimeName: "SSO",
    fragmentsCataloged: 533,
    parentMassKg: 2000,
    eventType: "breakup",
    cause: "Residual-propellant explosion of LM-6A second stage 6 weeks after Yunhai-3 deployment at 846 km.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv27i2.pdf",
  },
  {
    parentNoradId: 56564,
    parentName: "Long March 6A upper stage (2)",
    parentOperatorCountry: "CN",
    dateUtc: new Date("2024-08-06T00:00:00Z"),
    regimeName: "LEO",
    fragmentsCataloged: 700,
    parentMassKg: 2000,
    eventType: "breakup",
    cause: "Second LM-6A upper-stage breakup, this time at 800 km after Thousand Sails constellation deployment. Repeat of 2022 failure mode.",
    sourceUrl: "https://www.space-track.org/",
  },
  {
    parentNoradId: 38744,
    parentName: "Briz-M tank (Proton)",
    parentOperatorCountry: "RU",
    dateUtc: new Date("2012-10-16T00:00:00Z"),
    regimeName: "GTO",
    fragmentsCataloged: 520,
    parentMassKg: 2300,
    eventType: "breakup",
    cause: "Fuel-tank rupture of Breeze-M upper stage after a stranded Proton mission; multi-year debris shedding across GTO.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv17i1.pdf",
  },
  {
    parentNoradId: 27006,
    parentName: "Briz-M (Express-AM4)",
    parentOperatorCountry: "RU",
    dateUtc: new Date("2016-01-16T00:00:00Z"),
    regimeName: "GTO",
    fragmentsCataloged: 104,
    parentMassKg: 2300,
    eventType: "breakup",
    cause: "Breeze-M residual-propellant explosion of the Express-AM4 upper stage at GTO apogee.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv20i2.pdf",
  },
  {
    parentNoradId: 22220,
    parentName: "Pegasus HAPS",
    parentOperatorCountry: "US",
    dateUtc: new Date("1996-06-03T00:00:00Z"),
    regimeName: "LEO",
    fragmentsCataloged: 746,
    parentMassKg: 191,
    eventType: "breakup",
    cause: "Pegasus Hydrazine Auxiliary Propulsion System upper-stage explosion; cataloged fragments declined slowly over 20+ years.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/library/odqnv3i3.pdf",
  },
  {
    parentNoradId: 35758,
    parentName: "DMSP F14 (did NOT break — placeholder removed)",
    parentOperatorCountry: "US",
    dateUtc: new Date("2004-02-01T00:00:00Z"),
    regimeName: "SSO",
    fragmentsCataloged: 0,
    parentMassKg: null,
    eventType: "anomaly",
    cause: "Solar-array deployment anomaly without fragmentation; included here as contrasting non-event for analog work.",
    sourceUrl: null,
  },
  {
    parentNoradId: 14362,
    parentName: "Cosmos 1375",
    parentOperatorCountry: "RU",
    dateUtc: new Date("1982-06-18T00:00:00Z"),
    regimeName: "LEO",
    fragmentsCataloged: 46,
    parentMassKg: 1400,
    eventType: "asat_test",
    cause: "Early Soviet Istrebitel Sputnikov ASAT interception target; small fragment tally kept the event analytically tractable.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/library/history-of-on-orbit-satellite-fragmentations-16th-edition.pdf",
  },
  {
    parentNoradId: 10736,
    parentName: "NOAA-3 (defunct)",
    parentOperatorCountry: "US",
    dateUtc: new Date("2015-03-20T00:00:00Z"),
    regimeName: "SSO",
    fragmentsCataloged: 26,
    parentMassKg: 340,
    eventType: "breakup",
    cause: "Battery-venting event on long-defunct weather satellite; minor fragmentation near SSO 1500 km.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv19i2.pdf",
  },
  {
    parentNoradId: 27424,
    parentName: "RESURS-O1",
    parentOperatorCountry: "RU",
    dateUtc: new Date("2001-10-12T00:00:00Z"),
    regimeName: "SSO",
    fragmentsCataloged: 85,
    parentMassKg: 1900,
    eventType: "breakup",
    cause: "Fuel-system rupture on retired Russian Earth-observation sat at 830 km SSO.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/library/odqnv6i1.pdf",
  },
  {
    parentNoradId: 11871,
    parentName: "Ariane 3rd stage (SPELDA)",
    parentOperatorCountry: "FR",
    dateUtc: new Date("1986-11-13T00:00:00Z"),
    regimeName: "GTO",
    fragmentsCataloged: 498,
    parentMassKg: 1800,
    eventType: "breakup",
    cause: "Ariane V16 third stage explosion at GTO apogee; first major European-operator fragmentation event.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/library/history-of-on-orbit-satellite-fragmentations-16th-edition.pdf",
  },
  {
    parentNoradId: 45465,
    parentName: "Atlas V Centaur upper stage",
    parentOperatorCountry: "US",
    dateUtc: new Date("2018-08-30T00:00:00Z"),
    regimeName: "GEO",
    fragmentsCataloged: 59,
    parentMassKg: 2200,
    eventType: "breakup",
    cause: "Centaur upper-stage fragmentation near GEO after NROL-52; pattern repeated across multiple Centaur upper stages (2014 / 2019).",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv23i1.pdf",
  },
  {
    parentNoradId: 32710,
    parentName: "Kosmos 2421",
    parentOperatorCountry: "RU",
    dateUtc: new Date("2008-03-14T00:00:00Z"),
    regimeName: "LEO",
    fragmentsCataloged: 509,
    parentMassKg: 3250,
    eventType: "breakup",
    cause: "Onboard tank rupture of defunct Russian ELINT sat; 400 km LEO, rapid natural decay.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv12i3.pdf",
  },
  {
    parentNoradId: 39227,
    parentName: "Cosmos 2491",
    parentOperatorCountry: "RU",
    dateUtc: new Date("2023-02-03T00:00:00Z"),
    regimeName: "LEO",
    fragmentsCataloged: 85,
    parentMassKg: 225,
    eventType: "breakup",
    cause: "Unexplained fragmentation of small Russian military sat at 1500 km LEO.",
    sourceUrl: "https://www.space-track.org/",
  },
  {
    parentNoradId: 4814,
    parentName: "Thor-Agena D (SL-3) R/B",
    parentOperatorCountry: "US",
    dateUtc: new Date("1973-11-08T00:00:00Z"),
    regimeName: "LEO",
    fragmentsCataloged: 375,
    parentMassKg: 1000,
    eventType: "breakup",
    cause: "Residual-propellant explosion of Thor-Agena rocket body; classic 1970s-era upper-stage failure mode that catalyzed passivation standards.",
    sourceUrl: "https://orbitaldebris.jsc.nasa.gov/library/history-of-on-orbit-satellite-fragmentations-16th-edition.pdf",
  },
];

async function run(ctx: IngestionRunContext): Promise<IngestionResult> {
  const { db, logger } = ctx;
  const fetchedAt = new Date();
  const rows: NewFragmentationEvent[] = EVENTS.map((e) => ({
    ...e,
    source: "curated",
    fetchedAt,
  }));

  let inserted = 0;
  for (const row of rows) {
    const result = await db
      .insert(fragmentationEvent)
      .values(row)
      .onConflictDoUpdate({
        target: [fragmentationEvent.parentName, fragmentationEvent.dateUtc],
        set: {
          parentNoradId: row.parentNoradId,
          parentOperatorCountry: row.parentOperatorCountry,
          regimeName: row.regimeName,
          fragmentsCataloged: row.fragmentsCataloged,
          parentMassKg: row.parentMassKg,
          eventType: row.eventType,
          cause: row.cause,
          sourceUrl: row.sourceUrl,
          fetchedAt: row.fetchedAt,
        },
      });
    inserted += result.rowCount ?? 0;
  }

  logger.info(
    { inserted, total: rows.length },
    "fragmentation-events seed complete",
  );

  return {
    inserted,
    skipped: rows.length - inserted,
    notes: `Curated seed: ${rows.length} events upserted (${new Set(rows.map((r) => r.parentOperatorCountry)).size} operator countries)`,
  };
}

export const fragmentationEventsSource: IngestionSource<IngestionResult> = {
  id: "fragmentation-events",
  description: "Curated fragmentation-event seed (manual trigger)",
  run,
};

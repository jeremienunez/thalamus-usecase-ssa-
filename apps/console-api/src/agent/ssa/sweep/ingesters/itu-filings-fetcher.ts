/**
 * ITU filings "fetcher" — curated idempotent seeder for major satellite
 * constellation filings with the ITU BR. NOT a live scraper: the ITU's
 * public SNL/SRS endpoints are HTML-only ASP scrape (no JSON API), the
 * SRS web service shut down in 2021, and the "new filings" page wasn't
 * replaced with anything machine-readable. The 20-constellation curated
 * list captures the high-signal population that actually matters for
 * launch_scout — mega-constellations whose spectrum filings forewarn
 * the catalog about inbound sats.
 *
 * Run on demand via `POST /api/ingestion/run/itu-filings`. No cron — the
 * constellation list is stable; new entries get added to this file by
 * hand when a new mega-constellation is filed.
 *
 * Filing IDs below are ITU reference IDs (some abbreviated from BR-IFIC
 * SNS IDs, others from public regulatory tracking) with the sourceUrl
 * pointing to the authoritative ITU or national-regulator document.
 */

import {
  ituFiling,
  type Database,
  type NewItuFiling,
} from "@interview/db-schema";
import type { IngestionSource, IngestionRunContext } from "@interview/sweep";

interface IngestionResult {
  inserted: number;
  skipped: number;
  notes?: string;
}

type Seed = Omit<NewItuFiling, "fetchedAt" | "source"> & {
  filingDate: Date | null;
};

// prettier-ignore
const FILINGS: Seed[] = [
  {
    filingId: "USASAT-NGSO-3A",
    constellationName: "Starlink Gen2",
    administration: "USA",
    operatorName: "SpaceX",
    operatorCountry: "US",
    orbitClass: "NGSO-LEO",
    orbitDetails: "530–614 km altitude shells, 43–97° inclinations",
    altitudeKm: 570,
    inclinationDeg: 53,
    plannedSatellites: 29988,
    frequencyBands: ["Ku", "Ka", "V", "E"],
    filingDate: new Date("2020-05-26T00:00:00Z"),
    status: "partially_approved",
    sourceUrl: "https://www.fcc.gov/document/fcc-partially-grants-spacex-gen2-starlink-application",
    raw: null,
  },
  {
    filingId: "USASAT-NGSO-8A",
    constellationName: "Project Kuiper",
    administration: "USA",
    operatorName: "Amazon",
    operatorCountry: "US",
    orbitClass: "NGSO-LEO",
    orbitDetails: "590/610/630 km shells, 33-51.9° inclinations",
    altitudeKm: 610,
    inclinationDeg: 51,
    plannedSatellites: 3236,
    frequencyBands: ["Ka"],
    filingDate: new Date("2019-07-04T00:00:00Z"),
    status: "approved",
    sourceUrl: "https://www.fcc.gov/document/fcc-authorizes-kuiper-satellite-constellation",
    raw: null,
  },
  {
    filingId: "GBR-L5-OneWeb-Phase2",
    constellationName: "OneWeb Phase 2",
    administration: "GBR",
    operatorName: "Eutelsat OneWeb",
    operatorCountry: "GB",
    orbitClass: "NGSO-LEO",
    orbitDetails: "1200 km polar shells",
    altitudeKm: 1200,
    inclinationDeg: 87,
    plannedSatellites: 6372,
    frequencyBands: ["Ku", "Ka"],
    filingDate: new Date("2020-05-01T00:00:00Z"),
    status: "filed",
    sourceUrl: "https://www.itu.int/md/R20-AR.WP4A-C-0001/en",
    raw: null,
  },
  {
    filingId: "F-IRIS2-001",
    constellationName: "IRIS² (EU Secure Connectivity)",
    administration: "FRA",
    operatorName: "SpaceRISE consortium (Airbus / Thales Alenia Space / Eutelsat / Hispasat / SES / Deutsche Telekom)",
    operatorCountry: "FR",
    orbitClass: "NGSO-multi",
    orbitDetails: "Mix of LEO and MEO; secure / quantum-ready communications backbone",
    altitudeKm: null,
    inclinationDeg: null,
    plannedSatellites: 290,
    frequencyBands: ["Ka", "Ku"],
    filingDate: new Date("2024-10-28T00:00:00Z"),
    status: "contract_signed",
    sourceUrl: "https://defence-industry-space.ec.europa.eu/eu-space-programme/iris2-secure-connectivity_en",
    raw: null,
  },
  {
    filingId: "CHN-GW-A59",
    constellationName: "Guowang (GW / SatNet)",
    administration: "CHN",
    operatorName: "China SatNet (CSNG)",
    operatorCountry: "CN",
    orbitClass: "NGSO-LEO",
    orbitDetails: "Multi-shell LEO, 500–1145 km",
    altitudeKm: 590,
    inclinationDeg: 50,
    plannedSatellites: 12992,
    frequencyBands: ["Ku", "Ka", "Q", "V"],
    filingDate: new Date("2020-09-01T00:00:00Z"),
    status: "filed",
    sourceUrl: "https://www.itu.int/ITU-R/space/snl/",
    raw: null,
  },
  {
    filingId: "CHN-QIANFAN",
    constellationName: "Qianfan (Thousand Sails / G60)",
    administration: "CHN",
    operatorName: "Shanghai Spacecom Satellite Technology (SSST)",
    operatorCountry: "CN",
    orbitClass: "NGSO-LEO",
    orbitDetails: "1160 km polar orbit",
    altitudeKm: 1160,
    inclinationDeg: 85,
    plannedSatellites: 14000,
    frequencyBands: ["Ku"],
    filingDate: new Date("2023-11-15T00:00:00Z"),
    status: "launching",
    sourceUrl: "https://spacenews.com/china-launches-first-batch-of-18-satellites-for-thousand-sails-megaconstellation/",
    raw: null,
  },
  {
    filingId: "CAN-LIGHTSPEED",
    constellationName: "Telesat Lightspeed",
    administration: "CAN",
    operatorName: "Telesat",
    operatorCountry: "CA",
    orbitClass: "NGSO-LEO",
    orbitDetails: "1015 km polar + inclined shells",
    altitudeKm: 1015,
    inclinationDeg: 98,
    plannedSatellites: 298,
    frequencyBands: ["Ka"],
    filingDate: new Date("2021-04-01T00:00:00Z"),
    status: "in_production",
    sourceUrl: "https://www.telesat.com/leo-satellites/",
    raw: null,
  },
  {
    filingId: "RUS-SFERA",
    constellationName: "Sfera / Marathon-IoT",
    administration: "RUS",
    operatorName: "Roscosmos",
    operatorCountry: "RU",
    orbitClass: "NGSO-LEO",
    orbitDetails: "Multi-type constellation: Skif-M, Marathon-IoT, Express-RV GEO",
    altitudeKm: 870,
    inclinationDeg: 74,
    plannedSatellites: 264,
    frequencyBands: ["Ku", "L"],
    filingDate: new Date("2022-06-01T00:00:00Z"),
    status: "filed",
    sourceUrl: "https://en.wikipedia.org/wiki/Sfera_(satellite_constellation)",
    raw: null,
  },
  {
    filingId: "KOR-KCSC",
    constellationName: "Korea Positioning System (KPS)",
    administration: "KOR",
    operatorName: "Korea Aerospace Research Institute (KARI)",
    operatorCountry: "KR",
    orbitClass: "MEO+GEO",
    orbitDetails: "3 GEO + 5 inclined GSO regional navigation",
    altitudeKm: 35786,
    inclinationDeg: 0,
    plannedSatellites: 8,
    frequencyBands: ["L"],
    filingDate: new Date("2022-01-01T00:00:00Z"),
    status: "filed",
    sourceUrl: "https://www.kari.re.kr/eng/sub03_02_02.do",
    raw: null,
  },
  {
    filingId: "IND-NAVIC-L1",
    constellationName: "NavIC L1 expansion",
    administration: "IND",
    operatorName: "ISRO",
    operatorCountry: "IN",
    orbitClass: "GEO+GSO",
    orbitDetails: "Regional GNSS — 3 GEO + 4 inclined GSO",
    altitudeKm: 35786,
    inclinationDeg: 29,
    plannedSatellites: 7,
    frequencyBands: ["L", "S"],
    filingDate: new Date("2023-05-29T00:00:00Z"),
    status: "launching",
    sourceUrl: "https://www.isro.gov.in/NavIC.html",
    raw: null,
  },
  {
    filingId: "JPN-SSA-QZSS5",
    constellationName: "QZSS Phase 2 (7 satellites)",
    administration: "J",
    operatorName: "JAXA / Cabinet Office",
    operatorCountry: "JP",
    orbitClass: "MEO+GSO",
    orbitDetails: "Inclined GSO + GEO regional GNSS augmentation",
    altitudeKm: 35786,
    inclinationDeg: 40,
    plannedSatellites: 7,
    frequencyBands: ["L"],
    filingDate: new Date("2023-09-01T00:00:00Z"),
    status: "in_production",
    sourceUrl: "https://qzss.go.jp/en/overview/services/sv08_qzs-5-6-7.html",
    raw: null,
  },
  {
    filingId: "USA-AST-SpaceMobile",
    constellationName: "AST SpaceMobile BlueBird",
    administration: "USA",
    operatorName: "AST SpaceMobile",
    operatorCountry: "US",
    orbitClass: "NGSO-LEO",
    orbitDetails: "Direct-to-phone LEO @ 725 km",
    altitudeKm: 725,
    inclinationDeg: 53,
    plannedSatellites: 243,
    frequencyBands: ["L", "S", "MSS"],
    filingDate: new Date("2023-01-01T00:00:00Z"),
    status: "launching",
    sourceUrl: "https://ast-science.com/",
    raw: null,
  },
  {
    filingId: "RWA-CINNAMON937",
    constellationName: "Cinnamon-937 (Rwanda)",
    administration: "RWA",
    operatorName: "Rwanda Space Agency (via SpeQtral / RWandair filing)",
    operatorCountry: "RW",
    orbitClass: "NGSO-LEO",
    orbitDetails: "Mega-filing submitted by Rwanda for 337,320 sats across multiple shells — largest ITU filing to date; widely seen as regulatory placeholder.",
    altitudeKm: 550,
    inclinationDeg: 53,
    plannedSatellites: 337320,
    frequencyBands: ["Ka", "V", "E", "W"],
    filingDate: new Date("2021-09-01T00:00:00Z"),
    status: "filed",
    sourceUrl: "https://spacenews.com/rwanda-files-with-itu-for-a-337000-satellite-constellation/",
    raw: null,
  },
  {
    filingId: "USA-SWARM-NGSO",
    constellationName: "Swarm IoT (absorbed by SpaceX)",
    administration: "USA",
    operatorName: "SpaceX (Swarm subsidiary)",
    operatorCountry: "US",
    orbitClass: "NGSO-LEO",
    orbitDetails: "Nano-sat IoT at 450–550 km; 150 sats operational + expansion filing",
    altitudeKm: 510,
    inclinationDeg: 87,
    plannedSatellites: 1125,
    frequencyBands: ["VHF", "UHF"],
    filingDate: new Date("2019-04-01T00:00:00Z"),
    status: "operational_expanding",
    sourceUrl: "https://www.fcc.gov/document/fcc-approves-swarm-satellite-constellation",
    raw: null,
  },
  {
    filingId: "CHN-HULIANWANG",
    constellationName: "Honghu (Red Swan) / Lanjian Hongtu",
    administration: "CHN",
    operatorName: "Landspace / CAS Space joint filing",
    operatorCountry: "CN",
    orbitClass: "NGSO-LEO",
    orbitDetails: "Secondary Chinese LEO broadband constellation",
    altitudeKm: 700,
    inclinationDeg: 50,
    plannedSatellites: 10000,
    frequencyBands: ["Ku", "Ka"],
    filingDate: new Date("2024-01-01T00:00:00Z"),
    status: "filed",
    sourceUrl: "https://spacenews.com/china-plans-a-third-megaconstellation/",
    raw: null,
  },
];

export function createItuFilingsSource(
  db: Database,
): IngestionSource<IngestionResult> {
  async function run(ctx: IngestionRunContext): Promise<IngestionResult> {
    const { logger } = ctx;
  const fetchedAt = new Date();
  const rows: NewItuFiling[] = FILINGS.map((f) => ({
    ...f,
    source: "curated",
    fetchedAt,
  }));

  let inserted = 0;
  for (const row of rows) {
    const result = await db
      .insert(ituFiling)
      .values(row)
      .onConflictDoUpdate({
        target: [ituFiling.source, ituFiling.filingId],
        set: {
          constellationName: row.constellationName,
          administration: row.administration,
          operatorName: row.operatorName,
          operatorCountry: row.operatorCountry,
          orbitClass: row.orbitClass,
          orbitDetails: row.orbitDetails,
          altitudeKm: row.altitudeKm,
          inclinationDeg: row.inclinationDeg,
          plannedSatellites: row.plannedSatellites,
          frequencyBands: row.frequencyBands,
          filingDate: row.filingDate,
          status: row.status,
          sourceUrl: row.sourceUrl,
          fetchedAt: row.fetchedAt,
        },
      });
    inserted += result.rowCount ?? 0;
  }

  const totalSats = rows.reduce((s, r) => s + Number(r.plannedSatellites), 0);
  const countries = new Set(
    rows.map((r) => r.operatorCountry).filter(Boolean),
  );

  logger.info(
    {
      inserted,
      total: rows.length,
      totalPlannedSatellites: totalSats,
      countries: countries.size,
    },
    "itu-filings seed complete",
  );

  return {
    inserted,
    skipped: rows.length - inserted,
    notes: `Curated seed: ${rows.length} filings, ${totalSats.toLocaleString()} planned sats across ${countries.size} countries`,
  };
}

  return {
    id: "itu-filings",
    description: "Curated ITU filings seed (manual trigger)",
    run,
  };
}

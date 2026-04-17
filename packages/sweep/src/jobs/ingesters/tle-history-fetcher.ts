/**
 * TLE history ingester — fetches active-satellite TLE sets from CelesTrak
 * per-group feeds, parses the two-line-element blocks, and persists each
 * `(satellite_id, epoch)` to `tle_history`. Idempotent on re-run.
 *
 * Why per-group and not `GROUP=active`: CelesTrak throttles the active
 * megafile with HTTP 403 when hit unauthenticated at scale. The union of
 * per-group feeds covers the same catalog without needing auth.
 */

import { sql } from "drizzle-orm";
import { tleHistory, type NewTleHistory } from "@interview/db-schema";
import type { IngestionFetcher } from "../ingestion-registry";

const CELESTRAK_GROUPS = [
  "stations", "starlink", "oneweb", "iridium-next", "planet",
  "intelsat", "geo", "gps-ops", "galileo", "beidou", "weather",
  "noaa", "goes", "resource", "sarsat", "dmc", "tdrss", "argos",
  "spire", "orbcomm", "globalstar", "swarm", "ses", "telesat",
  "eutelsat", "amateur", "x-comm", "other-comm", "gnss", "glo-ops",
  "sbas", "nnss", "musson", "science", "geodetic", "engineering",
  "education", "military", "radar", "visual",
];

const CELESTRAK_BASE =
  process.env.CELESTRAK_BASE ?? "https://celestrak.org/NORAD/elements/gp.php";

interface ParsedTle {
  noradId: number;
  epoch: string;
  meanMotion: number;
  eccentricity: number;
  inclinationDeg: number;
  raan: number;
  argOfPerigee: number;
  meanAnomaly: number;
  bstar: number;
}

/**
 * Parse a TLE line-1 + line-2 pair into orbital elements.
 * Duplicated from `packages/db-schema/src/seed/update-tle.ts` intentionally —
 * that file is a one-shot seed script and pulling it in as a library would
 * entangle the sweep package with the db-schema seed infra.
 */
function parseTleBlock(l1: string, l2: string): ParsedTle | null {
  try {
    const noradId = Number(l1.slice(2, 7).trim());
    if (!Number.isFinite(noradId)) return null;

    const yy = Number(l1.slice(18, 20));
    const doy = Number(l1.slice(20, 32));
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const msPerDay = 86_400_000;
    const epochMs = Date.UTC(year, 0, 1) + (doy - 1) * msPerDay;
    const epoch = new Date(epochMs).toISOString();

    // Bstar drag term — line 1 cols 54-61, assumed-decimal-point format like
    //   " 12345-3" → 0.12345e-3. Preserve sign.
    const bstarRaw = l1.slice(53, 61).trim();
    const bstarSign = bstarRaw.startsWith("-") ? -1 : 1;
    const bstarDigits = bstarRaw.replace(/^[-+]/, "").replace(/\s+/g, "");
    // Format: MMMMM[+-]EE where MMMMM is mantissa (no decimal) and EE is exponent
    const expMatch = bstarDigits.match(/^(\d+)([+-]\d+)$/);
    const bstar = expMatch
      ? bstarSign * Number(`0.${expMatch[1]}`) * Math.pow(10, Number(expMatch[2]))
      : 0;

    const inclinationDeg = Number(l2.slice(8, 16).trim());
    const raan = Number(l2.slice(17, 25).trim());
    const eccentricity = Number("0." + l2.slice(26, 33).trim());
    const argOfPerigee = Number(l2.slice(34, 42).trim());
    const meanAnomaly = Number(l2.slice(43, 51).trim());
    const meanMotion = Number(l2.slice(52, 63).trim());

    if (
      ![
        inclinationDeg,
        raan,
        eccentricity,
        argOfPerigee,
        meanAnomaly,
        meanMotion,
      ].every(Number.isFinite)
    )
      return null;

    return {
      noradId,
      epoch,
      meanMotion,
      eccentricity,
      inclinationDeg,
      raan,
      argOfPerigee,
      meanAnomaly,
      bstar,
    };
  } catch {
    return null;
  }
}

async function fetchGroup(group: string): Promise<ParsedTle[]> {
  const url = `${CELESTRAK_BASE}?GROUP=${group}&FORMAT=tle`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      "User-Agent":
        "thalamus-ssa-ingest/0.1 (interview-project; contact: jerem@interview-project.invalid)",
      Accept: "text/plain, */*",
    },
  });
  if (!res.ok) return [];
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((s) => s.length > 0);
  const out: ParsedTle[] = [];
  for (let i = 0; i < lines.length - 2; i += 3) {
    const parsed = parseTleBlock(lines[i + 1]!, lines[i + 2]!);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Ingester entry point — registered under jobName `tle-history`.
 * Pulls every CelesTrak group, deduplicates by NORAD, resolves to catalog
 * satelliteIds, and upserts into `tle_history`.
 */
export const tleHistoryFetcher: IngestionFetcher = async ({
  db,
  logger,
}) => {
  const byNorad = new Map<number, ParsedTle>();
  let fetchedGroups = 0;
  let failedGroups = 0;

  for (const group of CELESTRAK_GROUPS) {
    try {
      const parsed = await fetchGroup(group);
      fetchedGroups++;
      // Keep the newest TLE per NORAD across groups (same object can appear
      // in multiple groups — take whichever epoch is latest).
      for (const p of parsed) {
        const existing = byNorad.get(p.noradId);
        if (!existing || existing.epoch < p.epoch) {
          byNorad.set(p.noradId, p);
        }
      }
    } catch (err) {
      failedGroups++;
      logger.warn(
        { group, err: err instanceof Error ? err.message : String(err) },
        "CelesTrak group fetch failed",
      );
    }
  }

  logger.info(
    {
      groupsFetched: fetchedGroups,
      groupsFailed: failedGroups,
      uniqueNorads: byNorad.size,
    },
    "CelesTrak fetch complete",
  );

  if (byNorad.size === 0) {
    return {
      inserted: 0,
      skipped: 0,
      notes: `All ${CELESTRAK_GROUPS.length} groups failed — no TLEs fetched`,
    };
  }

  // Resolve noradId → satellite.id. Pulls the whole catalog id-norad map
  // in one go (~33k rows, << 1 MB) — cheaper + simpler than chunked ANY()
  // lookups which can blow past Postgres' 1664 ROW-expression parser limit
  // when drizzle expands a large array literal inline.
  // `norad_id` is the top-level canonical column (33k rows); the
  // `telemetry_summary->>'noradId'` JSONB form only covers ~500 legacy
  // seed rows and must NOT be used as the sole source of truth.
  const result = await db.execute<{
    id: string | bigint;
    norad_id: number;
  }>(sql`
    SELECT id, norad_id
    FROM satellite
    WHERE norad_id IS NOT NULL
  `);

  const satByNorad = new Map<number, bigint>();
  for (const r of result.rows) {
    if (r.norad_id != null) satByNorad.set(Number(r.norad_id), BigInt(r.id));
  }

  // Build the insert batch
  const insertRows: NewTleHistory[] = [];

  let unmatched = 0;
  for (const [noradId, tle] of byNorad) {
    const satId = satByNorad.get(noradId);
    if (!satId) {
      unmatched++;
      continue;
    }
    insertRows.push({
      satelliteId: satId,
      noradId,
      epoch: new Date(tle.epoch),
      meanMotion: tle.meanMotion,
      eccentricity: tle.eccentricity,
      inclinationDeg: tle.inclinationDeg,
      raan: tle.raan,
      argOfPerigee: tle.argOfPerigee,
      meanAnomaly: tle.meanAnomaly,
      bstar: tle.bstar,
    });
  }

  // Chunked upsert via drizzle's insert builder — handles multi-row VALUES
  // correctly (one prepared statement per chunk). The raw sql-template
  // approach hit a Postgres "ROW expressions can have at most 1664 entries"
  // parser limit at any batch size because of how the tuples were flattened.
  // 150 rows per batch ≈ 35k params total on a 30k-satellite catalog.
  const CHUNK = 150;
  let inserted = 0;
  for (let i = 0; i < insertRows.length; i += CHUNK) {
    const chunk = insertRows.slice(i, i + CHUNK);
    const result = await db
      .insert(tleHistory)
      .values(chunk)
      .onConflictDoNothing({
        target: [tleHistory.satelliteId, tleHistory.epoch],
      });
    inserted += result.rowCount ?? 0;
  }

  const skipped = insertRows.length - inserted;
  return {
    inserted,
    skipped,
    notes: `${byNorad.size} unique TLEs from ${fetchedGroups}/${CELESTRAK_GROUPS.length} groups; ${unmatched} NORADs not in catalog`,
  };
};

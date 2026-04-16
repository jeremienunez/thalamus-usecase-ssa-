/**
 * One-shot: re-fetch CelesTrak active TLE + enrich
 * `satellite.telemetry_summary` in place with the full orbital element set
 * needed by the console globe (RAAN, argPerigee, meanAnomaly, epoch).
 *
 * Why: the initial seed only persisted {noradId, meanMotion, inclination,
 * eccentricity, regime} and used onConflictDoNothing, so existing rows
 * never received the richer fields that later revisions of the seed added.
 *
 * Usage:
 *   pnpm --filter @interview/db-schema exec tsx src/seed/update-tle.ts
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

// CelesTrak throttles the `active` megafile (HTTP 403 without auth) but
// serves per-constellation groups without restriction. Union them.
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
  process.env.CELESTRAK_BASE ??
  "https://celestrak.org/NORAD/elements/gp.php";

interface Tle {
  noradId: number;
  inclination: number;
  raan: number;
  eccentricity: number;
  argPerigee: number;
  meanAnomaly: number;
  meanMotion: number;
  epoch: string;
  line1: string;
  line2: string;
}

function parseTleBlock(l1: string, l2: string): Tle | null {
  try {
    const noradId = Number(l1.slice(2, 7).trim());
    if (!Number.isFinite(noradId)) return null;

    // Epoch — YYDDD.DDDDDDDD on line 1 cols 18-32
    const yy = Number(l1.slice(18, 20));
    const doy = Number(l1.slice(20, 32));
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const msPerDay = 86_400_000;
    const epochMs = Date.UTC(year, 0, 1) + (doy - 1) * msPerDay;
    const epoch = new Date(epochMs).toISOString();

    const inclination = Number(l2.slice(8, 16).trim());
    const raan = Number(l2.slice(17, 25).trim());
    const eccentricity = Number("0." + l2.slice(26, 33).trim());
    const argPerigee = Number(l2.slice(34, 42).trim());
    const meanAnomaly = Number(l2.slice(43, 51).trim());
    const meanMotion = Number(l2.slice(52, 63).trim());

    if (
      ![inclination, raan, eccentricity, argPerigee, meanAnomaly, meanMotion]
        .every(Number.isFinite)
    )
      return null;

    return {
      noradId,
      inclination,
      raan,
      eccentricity,
      argPerigee,
      meanAnomaly,
      meanMotion,
      epoch,
      line1: l1,
      line2: l2,
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgres://thalamus:thalamus@localhost:5433/thalamus";

  const tles: Tle[] = [];
  const seen = new Set<number>();

  for (const group of CELESTRAK_GROUPS) {
    const url = `${CELESTRAK_BASE}?GROUP=${group}&FORMAT=tle`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          "User-Agent":
            "thalamus-ssa-ingest/0.1 (interview-project; contact: jerem@interview-project.invalid)",
          Accept: "text/plain, */*",
        },
      });
      if (!res.ok) {
        console.warn(`  ✗ ${group} HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      const lines = text.split(/\r?\n/).filter((s) => s.length > 0);
      let added = 0;
      for (let i = 0; i < lines.length - 2; i += 3) {
        const tle = parseTleBlock(lines[i + 1]!, lines[i + 2]!);
        if (!tle || seen.has(tle.noradId)) continue;
        seen.add(tle.noradId);
        tles.push(tle);
        added++;
      }
      console.log(`  ✓ ${group.padEnd(16)} +${added}`);
    } catch (err) {
      console.warn(`  ✗ ${group}`, (err as Error).message);
    }
  }
  console.log(`▸ parsed ${tles.length} unique TLE blocks across ${CELESTRAK_GROUPS.length} groups`);

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  let updated = 0;
  let missing = 0;
  for (const t of tles) {
    const patch = JSON.stringify({
      noradId: t.noradId,
      meanMotion: t.meanMotion,
      inclination: t.inclination,
      eccentricity: t.eccentricity,
      raan: t.raan,
      argPerigee: t.argPerigee,
      meanAnomaly: t.meanAnomaly,
      epoch: t.epoch,
      tleLine1: t.line1,
      tleLine2: t.line2,
    });
    const r = await db.execute(sql`
      UPDATE satellite
         SET telemetry_summary = COALESCE(telemetry_summary, '{}'::jsonb) || ${patch}::jsonb
       WHERE (telemetry_summary->>'noradId')::int = ${t.noradId}
    `);
    if (r.rowCount && r.rowCount > 0) updated++;
    else missing++;
  }

  console.log(`✓ updated ${updated} satellites, ${missing} not in DB`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

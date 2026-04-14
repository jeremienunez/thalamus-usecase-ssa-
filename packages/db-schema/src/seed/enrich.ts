#!/usr/bin/env tsx
/**
 * Enrich — populate satellite.platform_class_id + satellite.mass_kg on rows
 * seeded by `seed/index.ts`.
 *
 * - Platform class is derived from CelesTrak's curated GROUPs (gps-ops,
 *   starlink, noaa, military, …). Coverage is high, source is public, no auth.
 * - Mass comes from a small hardcoded table of well-known flight-proven
 *   satellites (flagship missions + constellation bus bodies). Public
 *   comprehensive mass catalogs (GCAT, DISCOS) are gated; we keep the repo
 *   offline-friendly and leave the rest NULL — findings will surface the
 *   coverage gap, which is the correct behaviour.
 *
 * Idempotent: re-run any time. Uses NORAD id from telemetry_summary to match.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray, sql } from "drizzle-orm";
import { satellite, platformClass } from "../schema";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

type PlatformSlug =
  | "communications"
  | "earth_observation"
  | "navigation"
  | "sigint"
  | "science"
  | "military";

/**
 * CelesTrak GROUP → platform_class mapping.
 * Stable, curated, rate-limited. See https://celestrak.org/NORAD/elements/
 */
const GROUPS: Array<{ name: string; platform: PlatformSlug }> = [
  // Navigation
  { name: "gps-ops", platform: "navigation" },
  { name: "glo-ops", platform: "navigation" },
  { name: "galileo", platform: "navigation" },
  { name: "beidou", platform: "navigation" },
  { name: "sbas", platform: "navigation" },
  { name: "gnss", platform: "navigation" },
  // Communications
  { name: "starlink", platform: "communications" },
  { name: "oneweb", platform: "communications" },
  { name: "iridium-NEXT", platform: "communications" },
  { name: "intelsat", platform: "communications" },
  { name: "ses", platform: "communications" },
  { name: "eutelsat", platform: "communications" },
  { name: "telesat", platform: "communications" },
  { name: "orbcomm", platform: "communications" },
  { name: "globalstar", platform: "communications" },
  { name: "kuiper", platform: "communications" },
  { name: "geo", platform: "communications" },
  // Earth observation / weather
  { name: "weather", platform: "earth_observation" },
  { name: "noaa", platform: "earth_observation" },
  { name: "goes", platform: "earth_observation" },
  { name: "resource", platform: "earth_observation" },
  { name: "sarsat", platform: "earth_observation" },
  { name: "dmc", platform: "earth_observation" },
  { name: "planet", platform: "earth_observation" },
  { name: "spire", platform: "earth_observation" },
  // Military / radar
  { name: "military", platform: "military" },
  { name: "radar", platform: "military" },
  // Science
  { name: "science", platform: "science" },
  { name: "geodetic", platform: "science" },
  { name: "engineering", platform: "science" },
];

const CELESTRAK_QUERY = (group: string) =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=csv`;

async function fetchGroup(group: string): Promise<number[]> {
  const res = await fetch(CELESTRAK_QUERY(group), {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.warn(`  ⚠ ${group}: HTTP ${res.status}`);
    return [];
  }
  const csv = await res.text();
  const lines = csv.split("\n");
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",");
  const noradCol = header.indexOf("NORAD_CAT_ID");
  if (noradCol < 0) {
    console.warn(`  ⚠ ${group}: NORAD_CAT_ID column not found in header`);
    return [];
  }
  const norads: number[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const norad = Number(cols[noradCol]);
    if (Number.isFinite(norad) && norad > 0) norads.push(norad);
  }
  return norads;
}

/**
 * Mass-kg table — flagship missions + constellation bus defaults.
 * Source: operator tech sheets, published spec sheets, NASA / ESA pages.
 */
const MASS_BY_NORAD: Record<number, number> = {
  25544: 420_000, // ISS
  20580: 11_110, // Hubble Space Telescope
  28485: 8_211, // Envisat (nominal, decommissioned)
  39634: 2_300, // Sentinel-1A
  41335: 2_300, // Sentinel-1B
  40697: 1_140, // Sentinel-2A
  42063: 1_140, // Sentinel-2B
  41456: 1_140, // Sentinel-3A
  43013: 1_230, // Sentinel-3B
  49260: 3_880, // GPS III SV05
  48859: 3_880, // GPS III SV04
  43873: 3_880, // GPS III SV01
  40730: 714, // Galileo sat
  40544: 714,
  40889: 714,
  43566: 4_520, // GOES-17
  41866: 5_192, // GOES-16
  43226: 4_520, // GOES-18
  42836: 1_430, // TESS
  43435: 5_100, // JWST (deep space but catalogued)
  28654: 1_440, // CloudSat
  28929: 1_770, // MetOp-A
  38771: 1_770, // MetOp-B
  43689: 4_100, // Parker Solar Probe
  27424: 5_090, // Aqua
  25994: 4_864, // Terra
  41765: 1_100, // GRACE-FO 1
  41766: 1_100, // GRACE-FO 2
  27642: 1_365, // SCISAT-1
  36411: 1_770, // CryoSat-2
  47314: 2_650, // Landsat 9
  39084: 2_623, // Landsat 8
  26152: 2_200, // Terra SAR-X
};

/**
 * Bus-averages by name prefix. When NORAD lookup misses, fall back to the
 * first matching prefix. Values are published bus-mass averages (wet when
 * available) from operator tech sheets.
 */
const MASS_BY_NAME_PREFIX: Array<[RegExp, number]> = [
  [/^starlink[- ]/i, 300], // v1.0 (260) ↔ v2-mini (800)
  [/^iridium/i, 860], // Iridium NEXT
  [/^oneweb/i, 147],
  [/^navstar|^gps /i, 3000], // Block IIR-M ↔ III average
  [/^galileo/i, 714],
  [/^intelsat/i, 5000],
  [/^eutelsat/i, 5000],
  [/^astra/i, 5000],
  [/^directv/i, 5500],
  [/^galaxy/i, 5000],
  [/^inmarsat/i, 6000],
  [/^globalstar/i, 550],
  [/^orbcomm/i, 170],
  [/^sirius/i, 5800],
  [/^beidou/i, 2200],
  [/^shijian/i, 2000],
  [/^kepler/i, 70],
  [/^planet[- ]|^dove[- ]|^flock/i, 5],
  [/^spire[- ]|^lemur/i, 5],
  [/^kuiper/i, 500],
  [/^telesat|^lightspeed/i, 700],
  [/^himawari/i, 3500],
  [/^metop/i, 4100],
  [/^noaa/i, 1400],
  [/^goes/i, 4500],
  [/^terra sar|^terrasar/i, 1340],
  [/^cosmos/i, 1800], // rough average — diverse bus
  [/^usa[- ]/i, 3000], // US military, diverse
];

async function main(): Promise<void> {
  console.log(`▸ connecting to ${DATABASE_URL.replace(/\/\/[^@]+@/, "//***@")}`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  // 1. Load platform_class lookup
  const platforms = await db.select().from(platformClass);
  const platformByName = new Map(platforms.map((p) => [p.name, p.id]));
  for (const p of [
    "communications",
    "earth_observation",
    "navigation",
    "sigint",
    "science",
    "military",
  ] as const) {
    if (!platformByName.has(p)) {
      console.warn(`  ⚠ platform_class '${p}' not in DB — did you run seed?`);
    }
  }

  // 2. Fetch every CelesTrak group, build NORAD → platform map
  console.log(`▸ fetching ${GROUPS.length} CelesTrak groups`);
  const platformByNorad = new Map<number, PlatformSlug>();
  for (const g of GROUPS) {
    const norads = await fetchGroup(g.name);
    for (const n of norads) {
      // First-seen wins — groups are ordered from most-specific to most-generic
      // (e.g. gps-ops before the generic "gnss"); Starlink is communications even
      // if also in "last-30-days", etc.
      if (!platformByNorad.has(n)) platformByNorad.set(n, g.platform);
    }
    console.log(`  ✓ ${g.name}: ${norads.length}`);
    // be polite to CelesTrak
    await new Promise((r) => setTimeout(r, 250));
  }

  // 3. Read satellites from DB, join NORAD from telemetry_summary
  const rows = await db
    .select({
      id: satellite.id,
      name: satellite.name,
      telemetrySummary: satellite.telemetrySummary,
    })
    .from(satellite);

  console.log(`▸ enriching ${rows.length} satellites`);

  let platformHits = 0;
  let massHits = 0;
  const updates: Array<{
    id: bigint;
    platformClassId: bigint | null;
    massKg: number | null;
  }> = [];

  for (const r of rows) {
    const norad = Number(
      (r.telemetrySummary as { noradId?: number } | null)?.noradId,
    );
    if (!Number.isFinite(norad)) continue;

    // Platform class
    let platformClassId: bigint | null = null;
    const slug = platformByNorad.get(norad);
    if (slug) {
      platformClassId = platformByName.get(slug) ?? null;
      if (platformClassId) platformHits++;
    }

    // Mass lookup: exact NORAD id > name prefix.
    let massKg: number | null = MASS_BY_NORAD[norad] ?? null;
    if (massKg == null) {
      for (const [re, kg] of MASS_BY_NAME_PREFIX) {
        if (re.test(r.name)) {
          massKg = kg;
          break;
        }
      }
    }
    if (massKg != null) massHits++;

    if (platformClassId != null || massKg != null) {
      updates.push({ id: r.id, platformClassId, massKg });
    }
  }

  console.log(
    `  • platform_class matches: ${platformHits}/${rows.length}`,
  );
  console.log(`  • mass_kg matches:        ${massHits}/${rows.length}`);

  // 4. Batch update
  if (updates.length === 0) {
    console.log("(nothing to update)");
    await pool.end();
    return;
  }

  console.log(`▸ applying ${updates.length} updates`);
  // Chunk to keep single statements sane.
  const CHUNK = 200;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = updates.slice(i, i + CHUNK);
    await db.transaction(async (tx) => {
      for (const u of batch) {
        await tx
          .update(satellite)
          .set({
            platformClassId: u.platformClassId ?? undefined,
            massKg: u.massKg ?? undefined,
          })
          .where(eq(satellite.id, u.id));
      }
    });
  }

  // 5. Post-conditions
  const after = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM satellite) AS total,
      (SELECT count(*)::int FROM satellite WHERE platform_class_id IS NOT NULL) AS with_platform,
      (SELECT count(*)::int FROM satellite WHERE mass_kg IS NOT NULL) AS with_mass
  `);
  console.log("▸ post-conditions:", after.rows[0]);
  console.log("✓ enrichment complete");

  void inArray; // quiet unused-import lint — kept for future batch-WHERE optim

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

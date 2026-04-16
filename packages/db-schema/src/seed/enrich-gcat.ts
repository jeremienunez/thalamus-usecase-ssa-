#!/usr/bin/env tsx
/**
 * GCAT enrichment — pull mass + bus + manufacturer from Jonathan McDowell's
 * General Catalog of Artificial Space Objects (68k+ entries, CC-BY).
 *
 * https://planet4589.org/space/gcat/tsv/cat/satcat.tsv
 *
 * Fills in the biggest gap the system flagged: 967/1504 satellites without
 * mass. GCAT has mass for flight-proven objects with published specs (most
 * of the catalog).
 *
 * Idempotent. Re-run any time.
 */

import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { satellite, satelliteBus } from "../schema";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

const GCAT_URL =
  process.env.GCAT_URL ??
  "https://planet4589.org/space/gcat/tsv/cat/satcat.tsv";
const GCAT_CACHE = "/tmp/gcat.tsv";

/** GCAT column layout (tab-separated). */
const COL = {
  SATCAT: 1,
  MANUFACTURER: 16,
  BUS: 17,
  MASS: 19, // wet
  DRY_MASS: 21,
  TOT_MASS: 23,
};

interface GcatRow {
  norad: number;
  massKg: number | null;
  bus: string | null;
  manufacturer: string | null;
}

async function loadGcat(): Promise<Map<number, GcatRow>> {
  let buffer: string;
  try {
    buffer = readFileSync(GCAT_CACHE, "utf8");
    console.log(`▸ using cached GCAT at ${GCAT_CACHE} (${buffer.length} bytes)`);
  } catch {
    console.log(`▸ fetching GCAT from ${GCAT_URL}`);
    const res = await fetch(GCAT_URL, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`GCAT HTTP ${res.status}`);
    buffer = await res.text();
  }

  const byNorad = new Map<number, GcatRow>();
  for (const line of buffer.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    const satcat = cols[COL.SATCAT]?.trim();
    if (!satcat) continue;
    const norad = Number(satcat);
    if (!Number.isFinite(norad) || norad <= 0) continue;

    // Prefer DryMass, fall back to Mass, then TotMass — all in kg.
    const parseMass = (s: string | undefined): number | null => {
      if (!s) return null;
      const v = Number(s.trim());
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    const massKg =
      parseMass(cols[COL.DRY_MASS]) ??
      parseMass(cols[COL.MASS]) ??
      parseMass(cols[COL.TOT_MASS]);

    const bus = cols[COL.BUS]?.trim();
    const manufacturer = cols[COL.MANUFACTURER]?.trim();

    byNorad.set(norad, {
      norad,
      massKg,
      bus: bus && bus !== "-" && bus !== "" ? bus : null,
      manufacturer:
        manufacturer && manufacturer !== "-" && manufacturer !== ""
          ? manufacturer
          : null,
    });
  }
  return byNorad;
}

async function main(): Promise<void> {
  console.log(`▸ connecting to ${DATABASE_URL.replace(/\/\/[^@]+@/, "//***@")}`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  const gcat = await loadGcat();
  console.log(`▸ parsed GCAT: ${gcat.size} entries`);

  // Pre-seed satellite_bus with every distinct bus string we saw, so we
  // can FK in the update pass.
  const busNames = new Set<string>();
  for (const row of gcat.values()) {
    if (row.bus) busNames.add(row.bus);
  }
  console.log(`▸ upserting ${busNames.size} satellite_bus rows`);
  for (const name of busNames) {
    await db
      .insert(satelliteBus)
      .values({ name })
      .onConflictDoNothing();
  }

  const busRows = await db.select().from(satelliteBus);
  const busIdByName = new Map(busRows.map((b) => [b.name, b.id]));

  // Read satellites
  const rows = await db
    .select({
      id: satellite.id,
      name: satellite.name,
      noradId: satellite.noradId,
      currentMass: satellite.massKg,
      currentBus: satellite.satelliteBusId,
    })
    .from(satellite);

  console.log(`▸ enriching ${rows.length} satellites against GCAT`);
  let massHits = 0;
  let busHits = 0;
  const updates: Array<{
    id: bigint;
    massKg: number | null;
    satelliteBusId: bigint | null;
  }> = [];

  for (const r of rows) {
    const norad = r.noradId;
    if (norad == null || !Number.isFinite(norad)) continue;
    const g = gcat.get(norad);
    if (!g) continue;

    // Only overwrite NULLs — don't clobber existing values.
    const newMass = r.currentMass == null && g.massKg != null ? g.massKg : null;
    const newBusId =
      r.currentBus == null && g.bus ? busIdByName.get(g.bus) ?? null : null;

    if (newMass != null) massHits++;
    if (newBusId != null) busHits++;
    if (newMass != null || newBusId != null) {
      updates.push({ id: r.id, massKg: newMass, satelliteBusId: newBusId });
    }
  }

  console.log(`  • mass backfill:  ${massHits}`);
  console.log(`  • bus backfill:   ${busHits}`);

  if (updates.length === 0) {
    console.log("(nothing to update)");
    await pool.end();
    return;
  }

  console.log(`▸ applying ${updates.length} updates`);
  const CHUNK = 200;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = updates.slice(i, i + CHUNK);
    await db.transaction(async (tx) => {
      for (const u of batch) {
        const patch: { massKg?: number; satelliteBusId?: bigint } = {};
        if (u.massKg != null) patch.massKg = u.massKg;
        if (u.satelliteBusId != null) patch.satelliteBusId = u.satelliteBusId;
        await tx.update(satellite).set(patch).where(eq(satellite.id, u.id));
      }
    });
  }

  const after = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM satellite) AS total,
      (SELECT count(*)::int FROM satellite WHERE mass_kg IS NOT NULL) AS with_mass,
      (SELECT count(*)::int FROM satellite WHERE satellite_bus_id IS NOT NULL) AS with_bus,
      (SELECT count(*)::int FROM satellite WHERE platform_class_id IS NOT NULL) AS with_platform
  `);
  console.log("▸ post-conditions:", after.rows[0]);
  console.log("✓ GCAT enrichment complete");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

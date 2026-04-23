#!/usr/bin/env tsx
/**
 * Populate `satellite` with the full CelesTrak SATCAT (alive objects only).
 *
 *   https://celestrak.org/pub/satcat.csv  (~6 MB, 68k rows, public domain)
 *
 * Why this source:
 *   - OBJECT_TYPE column is authoritative: PAY / R/B / DEB / UNK → our
 *     `object_class` enum (payload / rocket_stage / debris / unknown).
 *   - APOGEE / PERIGEE / INCLINATION come pre-computed by CelesTrak,
 *     which is what the broad-phase conjunction pruner needs.
 *   - DECAY_DATE filters out re-entered objects cleanly.
 *
 * Upserts by `norad_id` — existing 500-row payload seed is preserved,
 * only `object_class` and orbital bands are filled in.
 *
 * Usage:
 *   pnpm --filter @interview/db-schema exec tsx src/seed/populate-space-catalog.ts
 *
 * Idempotent. Re-run any time the CelesTrak cache is stale.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { satellite } from "../schema";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

const SATCAT_URL =
  process.env.SATCAT_URL ?? "https://celestrak.org/pub/satcat.csv";
const CACHE_PATH = process.env.SATCAT_CACHE ?? "/tmp/celestrak-satcat.csv";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ─── Parsing ────────────────────────────────────────────────────────────────

interface SatcatRow {
  noradId: number;
  name: string;
  intldes: string;
  objectClass: "payload" | "rocket_stage" | "debris" | "unknown";
  ownerCode: string | null;
  launchYear: number | null;
  launchDate: string | null;
  decayDate: string | null;
  periodMin: number | null;
  inclinationDeg: number | null;
  apogeeKm: number | null;
  perigeeKm: number | null;
  rcsM2: number | null;
  opsStatus: string | null;
}

const OBJECT_TYPE_MAP: Record<string, SatcatRow["objectClass"]> = {
  PAY: "payload",
  "R/B": "rocket_stage",
  DEB: "debris",
  UNK: "unknown",
};

export function parseNumber(s: string): number | null {
  if (!s || s === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/**
 * Minimal CSV parser — the CelesTrak file has no embedded commas or quotes
 * in the columns we consume. A full CSV library would be overkill for ~6 MB.
 */
export function parseSatcatCsv(body: string): SatcatRow[] {
  const lines = body.split("\n");
  const header = lines[0]!.split(",");
  const idx = (name: string): number => header.indexOf(name);
  const I = {
    name: idx("OBJECT_NAME"),
    intldes: idx("OBJECT_ID"),
    norad: idx("NORAD_CAT_ID"),
    type: idx("OBJECT_TYPE"),
    ops: idx("OPS_STATUS_CODE"),
    owner: idx("OWNER"),
    launch: idx("LAUNCH_DATE"),
    decay: idx("DECAY_DATE"),
    period: idx("PERIOD"),
    incl: idx("INCLINATION"),
    apogee: idx("APOGEE"),
    perigee: idx("PERIGEE"),
    rcs: idx("RCS"),
  };

  const out: SatcatRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line) continue;
    const c = line.split(",");
    const norad = Number(c[I.norad]);
    if (!Number.isFinite(norad) || norad <= 0) continue;

    const decayDate = (c[I.decay] ?? "").trim();
    if (decayDate !== "") continue; // filter re-entered objects

    const typeCode = (c[I.type] ?? "").trim();
    const objectClass = OBJECT_TYPE_MAP[typeCode] ?? "unknown";

    const launchDate = (c[I.launch] ?? "").trim() || null;
    const launchYear = launchDate ? Number(launchDate.slice(0, 4)) : null;

    out.push({
      noradId: norad,
      name: (c[I.name] ?? "").trim() || `NORAD ${norad}`,
      intldes: (c[I.intldes] ?? "").trim(),
      objectClass,
      ownerCode: (c[I.owner] ?? "").trim() || null,
      launchYear: Number.isFinite(launchYear) ? launchYear : null,
      launchDate,
      decayDate: null,
      periodMin: parseNumber(c[I.period] ?? ""),
      inclinationDeg: parseNumber(c[I.incl] ?? ""),
      apogeeKm: parseNumber(c[I.apogee] ?? ""),
      perigeeKm: parseNumber(c[I.perigee] ?? ""),
      rcsM2: parseNumber(c[I.rcs] ?? ""),
      opsStatus: (c[I.ops] ?? "").trim() || null,
    });
  }
  return out;
}

async function loadSatcat(): Promise<SatcatRow[]> {
  let body: string;
  const fresh =
    existsSync(CACHE_PATH) &&
    Date.now() - statSync(CACHE_PATH).mtimeMs < CACHE_TTL_MS;
  if (fresh) {
    console.log(`▸ using cached SATCAT at ${CACHE_PATH}`);
    body = readFileSync(CACHE_PATH, "utf8");
  } else {
    console.log(`▸ fetching SATCAT from ${SATCAT_URL}`);
    const res = await fetch(SATCAT_URL, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`SATCAT HTTP ${res.status}`);
    body = await res.text();
    writeFileSync(CACHE_PATH, body, "utf8");
  }
  return parseSatcatCsv(body);
}

// ─── Slug generation (fallback when name lookup fails) ──────────────────────

export function slugify(s: string, norad: number): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base ? `${base}-${norad}` : `norad-${norad}`;
}

// ─── Upsert ─────────────────────────────────────────────────────────────────

/**
 * Upsert a row by `norad_id`. New rows get full defaults; existing rows only
 * get `object_class` + orbital bands refreshed (preserving operator / bus /
 * mass populated by earlier enrichment passes).
 *
 * We stuff apogee / perigee / inclination / RCS / ops_status into
 * `metadata` JSONB for now — a dedicated column per field belongs in a
 * follow-up schema migration.
 */
export async function upsertBatch(
  db: Pick<ReturnType<typeof drizzle>, "execute">,
  rows: SatcatRow[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const r of rows) {
    const orbital = {
      apogeeKm: r.apogeeKm,
      perigeeKm: r.perigeeKm,
      inclinationDeg: r.inclinationDeg,
      periodMin: r.periodMin,
      rcsM2: r.rcsM2,
      opsStatus: r.opsStatus,
      intldes: r.intldes,
      source: "celestrak-satcat",
      fetchedAt: new Date().toISOString(),
    };

    const result = await db.execute(sql`
      INSERT INTO satellite (
        name, slug, norad_id, object_class, launch_year, metadata,
        created_at, updated_at
      )
      VALUES (
        ${r.name},
        ${slugify(r.name, r.noradId)},
        ${r.noradId},
        ${r.objectClass},
        ${r.launchYear},
        ${JSON.stringify(orbital)}::jsonb,
        NOW(), NOW()
      )
      ON CONFLICT (norad_id) DO UPDATE SET
        object_class = EXCLUDED.object_class,
        metadata = COALESCE(satellite.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        launch_year = COALESCE(satellite.launch_year, EXCLUDED.launch_year),
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `);
    const row = result.rows[0] as { inserted: boolean } | undefined;
    if (row?.inserted) inserted++;
    else updated++;
  }

  return { inserted, updated };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`▸ connecting to ${DATABASE_URL.replace(/\/\/[^@]+@/, "//***@")}`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  try {
    const rows = await loadSatcat();
    const byClass = new Map<string, number>();
    for (const r of rows) byClass.set(r.objectClass, (byClass.get(r.objectClass) ?? 0) + 1);
    console.log(
      `▸ parsed ${rows.length} alive objects:`,
      [...byClass.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
    );

    // Upsert in sequential batches of 500 to keep transaction size reasonable.
    const BATCH = 500;
    let totalInserted = 0;
    let totalUpdated = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { inserted, updated } = await upsertBatch(db, chunk);
      totalInserted += inserted;
      totalUpdated += updated;
      process.stdout.write(
        `\r  progress: ${i + chunk.length}/${rows.length}  (+${totalInserted} new, ${totalUpdated} updated)`,
      );
    }
    console.log(
      `\n▸ done. ${totalInserted} inserted, ${totalUpdated} updated.`,
    );

    const summary = await db.execute(sql`
      SELECT object_class, COUNT(*)::int AS n
      FROM satellite
      GROUP BY object_class
      ORDER BY n DESC
    `);
    console.log(`\n▸ satellite catalog by object_class:`);
    for (const row of summary.rows as Array<{ object_class: string | null; n: number }>) {
      console.log(`  ${String(row.object_class ?? "NULL").padEnd(14)} ${row.n}`);
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("\n✗ populate failed:", err);
    process.exit(1);
  });
}

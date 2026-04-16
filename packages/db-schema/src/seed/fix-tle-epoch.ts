#!/usr/bin/env tsx
/**
 * One-off backfill: parse real TLE epoch from telemetry_summary.tleLine1
 * (columns 18..32, YYDDD.DDDDDDDD) and store it as telemetry_summary.tleEpoch.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { parseTleEpoch } from "./index";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  const rows = await db.execute(sql`
    SELECT id, telemetry_summary->>'tleLine1' AS line1
    FROM satellite
    WHERE telemetry_summary ? 'tleLine1'
  `);

  console.log(`▸ scanning ${rows.rows.length} satellites with TLE line1`);

  let updated = 0;
  let skipped = 0;
  for (const r of rows.rows as Array<{ id: number; line1: string | null }>) {
    if (!r.line1) { skipped++; continue; }
    const epoch = parseTleEpoch(r.line1);
    if (!epoch) { skipped++; continue; }
    await db.execute(sql`
      UPDATE satellite
      SET telemetry_summary = telemetry_summary || jsonb_build_object('tleEpoch', ${epoch}::text)
      WHERE id = ${r.id}
    `);
    updated++;
  }

  const check = await db.execute(sql`
    SELECT count(*) AS n FROM satellite WHERE telemetry_summary ? 'tleEpoch'
  `);
  console.log(`✓ updated ${updated} (skipped ${skipped}); satellites with tleEpoch = ${(check.rows[0] as any).n}`);

  await pool.end();
}

main().catch((err) => {
  console.error("✗ fix-tle-epoch failed:", err);
  process.exit(1);
});

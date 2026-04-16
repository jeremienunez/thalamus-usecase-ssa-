#!/usr/bin/env tsx
/**
 * One-off backfill: recompute satellite.operator_id from satellite.name
 * using the updated `guessOperator` heuristic. Safe to re-run.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { satellite, operator } from "../schema";
import { guessOperator, guessCountry } from "./index";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  const ops = await db.select().from(operator);
  const opBySlug = new Map(ops.map((o) => [o.slug, o.id]));

  // Make sure new operators exist
  const NEW_OPS = [
    { slug: "eutelsat", name: "Eutelsat" },
    { slug: "imagesat", name: "ImageSat International" },
    { slug: "usaf", name: "United States Air Force / Space Force" },
  ];
  for (const o of NEW_OPS) {
    if (!opBySlug.has(o.slug)) {
      const res = await db
        .insert(operator)
        .values({ name: o.name, slug: o.slug })
        .returning({ id: operator.id });
      if (res[0]) opBySlug.set(o.slug, res[0].id);
    }
  }

  // operator_country lookup
  const countryRows = await db.execute(sql`SELECT id, slug FROM operator_country`);
  const countryBySlug = new Map<string, number>();
  for (const r of countryRows.rows as Array<{ id: number; slug: string }>) {
    if (!countryBySlug.has(r.slug)) countryBySlug.set(r.slug, r.id);
  }

  const sats = await db.select().from(satellite);
  console.log(`▸ scanning ${sats.length} satellites`);

  let updated = 0;
  for (const s of sats) {
    const opSlug = guessOperator(s.name);
    const countrySlug = guessCountry(s.name, opSlug);
    const newOpId = opBySlug.get(opSlug) ?? null;
    const newCountryId = countryBySlug.get(countrySlug) ?? null;
    if (newOpId == null) continue;
    if (s.operatorId === BigInt(newOpId) && s.operatorCountryId === (newCountryId ? BigInt(newCountryId) : null))
      continue;
    await db.execute(sql`
      UPDATE satellite SET operator_id = ${newOpId},
                           operator_country_id = ${newCountryId}
      WHERE id = ${s.id}
    `);
    updated++;
  }

  console.log(`✓ updated ${updated} satellites`);

  const top = await db.execute(sql`
    SELECT o.slug, count(*) AS n
    FROM satellite s LEFT JOIN operator o ON o.id = s.operator_id
    GROUP BY o.slug ORDER BY n DESC LIMIT 10
  `);
  console.log("▸ top operators:", top.rows);

  await pool.end();
}

main().catch((err) => {
  console.error("✗ fix-operators failed:", err);
  process.exit(1);
});

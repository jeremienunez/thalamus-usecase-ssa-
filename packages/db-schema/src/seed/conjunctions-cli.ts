#!/usr/bin/env tsx
/**
 * CLI wrapper for seedConjunctions — SGP4-propagated close-approach screening.
 *
 * Usage:
 *   pnpm --filter @interview/db-schema conjunctions
 *
 * Env:
 *   CONJ_WINDOW_DAYS     forward window (default 3)
 *   CONJ_STEP_SECONDS    propagation step (default 300 = 5 min)
 *   CONJ_THRESHOLD_KM    close-approach threshold (default 5)
 *   CONJ_MAX_PER_REGIME  max pairs per regime (default 150)
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { seedConjunctions } from "./conjunctions";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

async function main(): Promise<void> {
  console.log(`▸ connecting to ${DATABASE_URL.replace(/\/\/[^@]+@/, "//***@")}`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  const opts = {
    windowDays: Number(process.env.CONJ_WINDOW_DAYS ?? 3),
    stepSeconds: Number(process.env.CONJ_STEP_SECONDS ?? 300),
    thresholdKm: Number(process.env.CONJ_THRESHOLD_KM ?? 5),
    maxPerRegime: Number(process.env.CONJ_MAX_PER_REGIME ?? 150),
  };
  console.log("▸ options", opts);

  const t0 = Date.now();
  const result = await seedConjunctions(db, opts);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(
    `✓ done in ${elapsed}s — screened=${result.screened} candidates=${result.candidates} inserted=${result.inserted}`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

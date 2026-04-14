/**
 * Demo: end-to-end sweep audit pass.
 *
 * Boots a minimal sweep container against live Postgres + Redis, runs one nano
 * audit pass, lists suggestions written to Redis grouped by category + severity,
 * then picks an "accepted" suggestion and runs SweepResolutionService.resolve
 * to demonstrate the write-path.
 *
 * Usage:
 *   pnpm --filter @interview/sweep demo-run
 */

import IORedis from "ioredis";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@interview/db-schema";
import { buildSweepContainer } from "../config/container";

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgres://thalamus:thalamus@localhost:5433/thalamus";
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";

  console.log(`\n┌─ Sweep Demo Run ─────────────────────────────────────────`);
  console.log(`│ database: ${redact(databaseUrl)}`);
  console.log(`│ redis:    ${redisUrl}`);
  console.log(`└──────────────────────────────────────────────────────────\n`);

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const c = buildSweepContainer({ db, redis });

  // 1. Sweep
  console.log("[sweep] running nano audit pass (max 50 operator-countries)…");
  const t0 = Date.now();
  let result;
  try {
    result = await c.nanoSweepService.sweep(50, "dataQuality");
  } catch (err) {
    console.error("Sweep failed:", err instanceof Error ? err.message : err);
    await teardown(redis, pool);
    process.exit(1);
  }

  console.log(`\n┌─ Sweep Result ───────────────────────────────────────────`);
  console.log(`│ operatorCountries: ${result.totalOperatorCountries}`);
  console.log(`│ nanoCalls:         ${result.totalCalls} (${result.successCalls} ok)`);
  console.log(`│ suggestionsStored: ${result.suggestionsStored}`);
  console.log(`│ wallTime:          ${(result.wallTimeMs / 1000).toFixed(1)}s`);
  console.log(`│ estimatedCost:     $${result.estimatedCost.toFixed(4)}`);
  console.log(`└──────────────────────────────────────────────────────────\n`);

  // 2. List suggestions grouped by category + severity
  const { rows: suggestions } = await c.sweepRepo.list({ limit: 200 });

  if (suggestions.length === 0) {
    console.log("(no suggestions stored — nothing to resolve)\n");
    await teardown(redis, pool);
    return;
  }

  const grouped = new Map<string, number>();
  for (const s of suggestions) {
    const k = `${s.category}/${s.severity}`;
    grouped.set(k, (grouped.get(k) ?? 0) + 1);
  }
  console.log("Suggestions by category/severity:");
  console.log("  " + pad("group", 40) + " " + pad("count", 6));
  console.log("  " + "-".repeat(48));
  for (const [k, v] of [...grouped.entries()].sort()) {
    console.log("  " + pad(k, 40) + " " + pad(String(v), 6));
  }
  console.log(`  total: ${suggestions.length}\n`);

  // 3. Pick a critical suggestion (or any) with a resolutionPayload, accept + resolve
  const candidate =
    suggestions.find(
      (s) => s.severity === "critical" && s.resolutionPayload != null,
    ) ?? suggestions.find((s) => s.resolutionPayload != null);

  if (!candidate) {
    console.log("(no suggestion has a resolutionPayload — skipping resolve demo)\n");
    await teardown(redis, pool);
    return;
  }

  console.log(`[resolve] picking suggestion id=${candidate.id}`);
  console.log(`          ${candidate.category} / ${candidate.severity} — ${candidate.title}`);

  await c.sweepRepo.review(candidate.id, true, "demo auto-accept");

  const resolution = await c.resolutionService.resolve(candidate.id);

  console.log(`\n┌─ Resolution Result ──────────────────────────────────────`);
  console.log(`│ status:       ${resolution.status}`);
  console.log(`│ affectedRows: ${resolution.affectedRows}`);
  if (resolution.errors?.length) {
    console.log(`│ errors:       ${resolution.errors.slice(0, 3).join(" | ")}`);
  }
  if (resolution.pendingSelections?.length) {
    console.log(`│ pending:      ${resolution.pendingSelections.length} selection(s) needed`);
  }
  console.log(`└──────────────────────────────────────────────────────────\n`);

  // 4. Re-fetch the suggestion to show the audit row
  const after = await c.sweepRepo.getById(candidate.id);
  if (after) {
    console.log("Suggestion audit row (post-resolve):");
    console.log(`  id:               ${after.id}`);
    console.log(`  accepted:         ${after.accepted}`);
    console.log(`  reviewedAt:       ${after.reviewedAt}`);
    console.log(`  resolutionStatus: ${after.resolutionStatus}`);
    console.log(`  resolvedAt:       ${after.resolvedAt}`);
    console.log(`  resolutionErrors: ${after.resolutionErrors ?? "-"}`);
    console.log("");
  }

  await teardown(redis, pool);
}

async function teardown(redis: IORedis, pool: Pool): Promise<void> {
  try {
    await redis.quit();
  } catch {
    /* noop */
  }
  await pool.end();
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function redact(url: string): string {
  return url.replace(/\/\/[^@]+@/, "//***@");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

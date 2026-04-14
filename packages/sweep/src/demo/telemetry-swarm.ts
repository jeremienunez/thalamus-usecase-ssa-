#!/usr/bin/env tsx
/**
 * Demo — end-to-end telemetry-inference swarm.
 *
 * Picks a satellite whose bus matches a bus-datasheets.json entry, launches
 * a K-fish uc_telemetry_inference swarm via startTelemetrySwarm, boots the
 * fish + aggregate BullMQ workers in-process, waits for completion, and
 * prints the resulting sweep_suggestions (one per telemetry scalar).
 *
 * Usage:
 *   THALAMUS_MODE=cloud    pnpm --filter @interview/sweep demo:telemetry    # live LLMs
 *   THALAMUS_MODE=fixtures pnpm --filter @interview/sweep demo:telemetry    # fixture replay
 *
 *   SATELLITE_ID=804  pnpm --filter @interview/sweep demo:telemetry         # override target
 *   FISH_COUNT=5      pnpm --filter @interview/sweep demo:telemetry         # override K
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "@interview/db-schema";
import IORedis from "ioredis";
import {
  CortexRegistry,
} from "@interview/thalamus";
import {
  buildSweepContainer,
  createSwarmFishWorker,
  createSwarmAggregateWorker,
  emitSuggestionFromModal,
  emitTelemetrySuggestions,
  startTelemetrySwarm,
  setRedisClient,
  closeQueues,
} from "@interview/sweep";

const DB_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";

const DEFAULT_SAT_ID = 804; // NIMIQ 5 (SSL-1300)
const FISH_COUNT = Number(process.env.FISH_COUNT ?? 30);

async function main(): Promise<void> {
  const satelliteId = Number(process.env.SATELLITE_ID ?? DEFAULT_SAT_ID);
  const mode = (process.env.THALAMUS_MODE ?? "cloud") as "cloud" | "fixtures" | "record";

  console.log(`\n┌─ Telemetry Swarm Demo ──────────────────────────────────`);
  console.log(`│ mode:         ${mode}`);
  console.log(`│ database:     ${DB_URL.replace(/\/\/[^@]+@/, "//***@")}`);
  console.log(`│ satelliteId:  ${satelliteId}`);
  console.log(`│ fishCount:    ${FISH_COUNT}`);
  console.log(`└─────────────────────────────────────────────────────────\n`);

  const pool = new Pool({ connectionString: DB_URL });
  const db = drizzle(pool, { schema });
  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  setRedisClient(redis);

  const registry = new CortexRegistry();
  registry.discover();
  for (const required of ["sim_operator_agent", "telemetry_inference_agent"]) {
    if (!registry.get(required)) {
      throw new Error(
        `Skill '${required}' not discovered. Did you rebuild the thalamus skills/ directory?`,
      );
    }
  }

  const container = buildSweepContainer({
    db,
    redis,
    sim: {
      cortexRegistry: registry,
      // Embed stub: sim memory + aggregator fall back to recency when null.
      // Keeps the demo offline-friendly without a Voyage key.
      embed: async () => null,
      llmMode: mode,
    },
  });
  const sim = container.sim!;

  // Boot BOTH workers — the swarm pipeline needs fish-drain + aggregate-close.
  const fishWorker = createSwarmFishWorker({
    db,
    swarmService: sim.swarmService,
    sequentialRunner: sim.sequentialRunner,
    dagRunner: sim.dagRunner,
    concurrency: FISH_COUNT,
  });
  const aggregateWorker = createSwarmAggregateWorker({
    db,
    aggregator: sim.aggregator,
    telemetryAggregator: sim.telemetryAggregator,
    // sweepRepo.insertOne returns the id as a string; the worker types expect
    // number — adapter converts.
    emitSuggestion: async (swarmId, agg) => {
      const id = await emitSuggestionFromModal(
        { db, sweepRepo: container.sweepRepo },
        swarmId,
        agg,
      );
      return id != null ? Number(id) : null;
    },
    emitTelemetrySuggestions: async (_swarmId, agg) => {
      const ids = await emitTelemetrySuggestions(
        { db, sweepRepo: container.sweepRepo },
        agg,
      );
      return ids.map((s) => Number(s));
    },
    concurrency: 1,
  });
  await Promise.all([
    fishWorker.waitUntilReady(),
    aggregateWorker.waitUntilReady(),
  ]);

  const t0 = Date.now();
  console.log("▸ launching swarm …");
  const launch = await startTelemetrySwarm(
    { db, swarmService: sim.swarmService },
    { satelliteId, fishCount: FISH_COUNT, config: { llmMode: mode } },
  );
  console.log(
    `  swarmId=${launch.swarmId} fish=${launch.fishCount} firstSimRun=${launch.firstSimRunId}\n`,
  );

  // Poll sim_swarm.status until done or failed (or 180s timeout).
  const deadline = Date.now() + 180_000;
  let final: { status: string; completed_at: Date | null } | undefined;
  while (Date.now() < deadline) {
    const rows = await db.execute(sql`
      SELECT status, completed_at FROM sim_swarm WHERE id = ${BigInt(launch.swarmId)}
    `);
    final = rows.rows[0] as { status: string; completed_at: Date | null } | undefined;
    if (final && (final.status === "done" || final.status === "failed")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n┌─ Swarm outcome ────────────────────────────────────────`);
  console.log(`│ status:   ${final?.status ?? "timeout"}`);
  console.log(`│ elapsed:  ${elapsed}s`);
  console.log(`└────────────────────────────────────────────────────────\n`);

  // Fetch per-scalar suggestions emitted for this swarm.
  const suggestionRows = await db.execute(sql`
    SELECT
      hash.id                          AS id,
      hash.value->>'title'             AS title,
      hash.value->>'severity'          AS severity,
      hash.value->>'simDistribution'   AS dist
    FROM (
      SELECT '' AS id, '{}'::jsonb AS value WHERE FALSE
    ) hash
  `).catch(() => ({ rows: [] }));

  // Redis-only read — pending set for this swarm.
  const pendingIds = await redis.smembers("sweep:index:pending");
  const matching: Array<{ id: string; title: string; severity: string; field: string; median: number | null; sigma: number | null; n: number; unit: string }> = [];
  for (const id of pendingIds) {
    const h = await redis.hgetall(`sweep:suggestions:${id}`);
    if (!h.simSwarmId || h.simSwarmId !== String(launch.swarmId)) continue;
    let dist: {
      scalar?: string;
      stats?: { median?: number; sigma?: number; n?: number; unit?: string };
    } = {};
    try {
      dist = JSON.parse(h.simDistribution ?? "{}");
    } catch {
      // ignore
    }
    matching.push({
      id,
      title: h.title ?? "",
      severity: h.severity ?? "",
      field: dist.scalar ?? "?",
      median: dist.stats?.median ?? null,
      sigma: dist.stats?.sigma ?? null,
      n: dist.stats?.n ?? 0,
      unit: dist.stats?.unit ?? "",
    });
  }

  if (matching.length === 0) {
    console.log("(no telemetry suggestions emitted — check logs above)");
  } else {
    console.log("Emitted telemetry suggestions:");
    console.log(
      "  " + pad("field", 22) + pad("median", 14) + pad("σ", 12) + pad("n", 4) + " severity",
    );
    console.log("  " + "-".repeat(70));
    for (const s of matching) {
      console.log(
        "  " +
          pad(`${s.field} (${s.unit})`, 22) +
          pad(s.median != null ? String(Number(s.median).toFixed(3)) : "?", 14) +
          pad(s.sigma != null ? String(Number(s.sigma).toFixed(3)) : "?", 12) +
          pad(String(s.n), 4) +
          " " + s.severity,
      );
    }
  }

  console.log("");

  // Close order: workers first (so they stop draining), then queues, then
  // redis, then pool. Some BullMQ 5.x ↔ ioredis 5.x combos throw
  // ERR_OUT_OF_RANGE from setMaxListeners during close; it's cosmetic
  // (everything has already persisted) — swallow with an ignored error handler.
  const softClose = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "ERR_OUT_OF_RANGE") {
        console.warn(`[close] ${label} threw`, err);
      }
    }
  };
  await softClose("fishWorker", () => fishWorker.close());
  await softClose("aggregateWorker", () => aggregateWorker.close());
  await softClose("queues", () => closeQueues());
  await softClose("redis", () => redis.quit());
  await softClose("pool", () => pool.end());
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

main().catch((err) => {
  console.error("DEMO FAILED:", err);
  process.exit(1);
});

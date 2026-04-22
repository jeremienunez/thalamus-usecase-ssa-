import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import IORedis from "ioredis";
import { Pool } from "pg";
import {
  E2E_DATABASE_URL,
  seedSweepMissionSatellites,
} from "./helpers/db-fixtures";

/**
 * Integration tests — sweep mission expansion + guardrails.
 *
 * Given: a running console-api (pnpm --filter @interview/console-api dev)
 *        and Redis on the standard dev port.
 * When:  we seed known sweep suggestions directly in Redis and POST /api/sweep/mission/start
 * Then:  the queue materialises per-satellite tasks respecting all filters.
 *
 * Tests do NOT exercise the LLM call — that path is covered by fabrication
 * guardrails which live in the runtime. These tests cover the deterministic
 * task-expansion logic which is the bit most likely to regress.
 */

const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";

let redis: IORedis;
let pool: Pool;
let seededSatelliteIds: string[] = [];
const SEEDED_IDS: string[] = [];
let pendingSnapshot: string[] = [];

async function stopMissionIfRunning(): Promise<void> {
  await fetch(`${BASE}/api/sweep/mission/stop`, { method: "POST" }).catch((): void => {
    // Mission shutdown is best-effort during e2e cleanup.
  });
}

async function missionStatus(): Promise<{
  running: boolean;
  total: number;
  completed: number;
}> {
  const res = await fetch(`${BASE}/api/sweep/mission/status`);
  return (await res.json()) as { running: boolean; total: number; completed: number };
}

async function startMission(opts: {
  maxSatsPerSuggestion: number;
}): Promise<{
  alreadyRunning?: boolean;
  state: {
    running: boolean;
    total: number;
    completed: number;
    startedAt: string | null;
  };
}> {
  const res = await fetch(`${BASE}/api/sweep/mission/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  const text = await res.text();
  expect(res.ok, text).toBe(true);
  return JSON.parse(text) as {
    alreadyRunning?: boolean;
    state: {
      running: boolean;
      total: number;
      completed: number;
      startedAt: string | null;
    };
  };
}

async function startMissionWithCap(cap: number): Promise<{
  running: boolean;
  total: number;
  completed: number;
  startedAt: string | null;
}> {
  // Build a task list only — stop immediately afterward so no LLM call fires.
  const body = await startMission({ maxSatsPerSuggestion: cap });
  await stopMissionIfRunning();
  return body.state;
}

/**
 * Seed one sweep suggestion in Redis. Returns the id we used; caller is
 * responsible for adding it to SEEDED_IDS so afterAll can clean up.
 *
 * Uses very-high ids (9_900_000+) to avoid colliding with live data.
 */
async function seedSuggestion(opts: {
  id: string;
  operatorCountryName: string;
  field: string;
  satelliteIds: string[];
  value?: string | number | null;
  accepted?: string;
}): Promise<void> {
  const key = `sweep:suggestions:${opts.id}`;
  const payload = {
    actions: [
      {
        kind: "update_field",
        field: opts.field,
        value: opts.value === undefined ? null : opts.value,
        satelliteIds: opts.satelliteIds,
      },
    ],
  };
  await redis.hset(key, {
    id: opts.id,
    operatorCountryId: "",
    operatorCountryName: opts.operatorCountryName,
    category: "missing_data",
    severity: "warning",
    title: `seeded ${opts.id}`,
    description: "",
    affectedSatellites: String(opts.satelliteIds.length),
    suggestedAction: `Back-fill "${opts.field}"`,
    webEvidence: "",
    accepted: opts.accepted ?? "",
    reviewerNote: "",
    reviewedAt: "",
    createdAt: new Date().toISOString(),
    resolutionPayload: JSON.stringify(payload),
    resolutionStatus: "",
    resolvedAt: "",
    resolutionErrors: "",
    pendingSelections: "",
    simSwarmId: "",
    simDistribution: "",
  });
  await redis.sadd("sweep:index:pending", opts.id);
  SEEDED_IDS.push(opts.id);
}

async function cleanupSeeded(): Promise<void> {
  if (SEEDED_IDS.length === 0) return;
  for (const id of SEEDED_IDS) {
    await redis.del(`sweep:suggestions:${id}`);
    await redis.srem("sweep:index:pending", id);
  }
  SEEDED_IDS.length = 0;
}

describe("sweep mission — per-satellite task expansion", () => {
  beforeAll(async () => {
    redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    await redis.connect();
    pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
    const client = await pool.connect();
    try {
      seededSatelliteIds = await seedSweepMissionSatellites(client);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await cleanupSeeded();
    await redis.quit();
    await pool.end();
  });

  beforeEach(async () => {
    await stopMissionIfRunning();
    await cleanupSeeded();
    // Snapshot + clear live pending index so each test sees only its seeded
    // suggestions. Restored in afterEach.
    pendingSnapshot = await redis.smembers("sweep:index:pending");
    if (pendingSnapshot.length > 0) {
      await redis.srem("sweep:index:pending", ...pendingSnapshot);
    }
  });

  async function restorePending(): Promise<void> {
    if (pendingSnapshot.length > 0) {
      await redis.sadd("sweep:index:pending", ...pendingSnapshot);
      pendingSnapshot = [];
    }
  }

  afterEach(async () => {
    await stopMissionIfRunning();
    await cleanupSeeded();
    await restorePending();
  });

  it("skips suggestions whose operator country is Other / Unknown", async () => {
    await seedSuggestion({
      id: "9900001",
      operatorCountryName: "Other / Unknown",
      field: "lifetime",
      satelliteIds: ["1", "2", "3"],
    });
    const { total } = await startMissionWithCap(5);
    expect(total).toBe(0);
  });

  it("caps satellites per suggestion to respect maxSatsPerSuggestion", async () => {
    await seedSuggestion({
      id: "9900004",
      operatorCountryName: "United States",
      field: "lifetime",
      satelliteIds: seededSatelliteIds,
    });
    const state = await startMissionWithCap(3);
    expect(state.running).toBe(true);
    expect(state.startedAt).toMatch(/T/);
    expect(state.total).toBe(3);
  });

  it("expands one suggestion into one task per eligible satellite", async () => {
    await seedSuggestion({
      id: "9900005",
      operatorCountryName: "United States",
      field: "lifetime",
      satelliteIds: seededSatelliteIds.slice(0, 3),
    });
    const state = await startMissionWithCap(5);
    expect(state.total).toBe(3);

    const status = await missionStatus();
    expect(status.running).toBe(false);
    expect(status.total).toBe(3);
  });

  it("refuses to start a second mission while one is running", async () => {
    await seedSuggestion({
      id: "9900006",
      operatorCountryName: "United States",
      field: "lifetime",
      satelliteIds: seededSatelliteIds.slice(0, 5),
    });
    const firstBody = await startMission({ maxSatsPerSuggestion: 5 });
    expect(firstBody.state.running).toBe(true);
    expect(firstBody.state.total).toBe(5);

    const secondBody = await startMission({ maxSatsPerSuggestion: 5 });
    expect(secondBody.alreadyRunning).toBe(true);

    await stopMissionIfRunning();
    // Drain up to 2s so the in-flight tick doesn't bleed into the next test.
    for (let i = 0; i < 20; i++) {
      const s = await missionStatus();
      if (!s.running) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  });
});

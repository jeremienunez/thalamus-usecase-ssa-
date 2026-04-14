/**
 * E2E — CLI REPL with real adapters against live Postgres + Redis.
 *
 * Proves that boot.buildRealAdapters wires the full stack:
 *   - drizzle pool against thalamus-postgres
 *   - IORedis against thalamus-redis
 *   - thalamus ResearchGraphService (buildThalamusContainer)
 *   - sweep DI (buildSweepContainer, SweepResolutionService, SwarmService)
 *
 * Scenario: seed a `research_cycle` + `research_finding` + `research_edge`
 * row, mount the real adapters, then drive the REPL via `/explain <fid>`.
 * The why-tree adapter reads directly from Postgres — no LLM fixtures
 * required for this path, which is the whole point: we want proof that
 * the DB wiring is live.
 *
 * Prereqs (see swarm-uc3.e2e.spec.ts):
 *   - thalamus-postgres on :5433 with migrations applied
 *   - thalamus-redis on :6380
 */

import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { EventEmitter } from "node:events";
import React from "react";
import { Pool } from "pg";
import IORedis from "ioredis";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql, eq } from "drizzle-orm";
import { resolve } from "node:path";

import {
  researchCycle,
  researchEdge,
  researchFinding,
  operator,
  satellite,
} from "@interview/db-schema";
import { CortexRegistry } from "@interview/thalamus";
import {
  ResearchCortex,
  ResearchFindingType,
  ResearchStatus,
  ResearchCycleTrigger,
  ResearchCycleStatus,
  ResearchRelation,
  ResearchEntityType,
} from "@interview/shared/enum";

import { App } from "../../src/app";
import { buildRealAdapters } from "../../src/boot";
import type { Adapters } from "../../src/router/dispatch";

// Ink 4's useInput uses stdin.ref()/unref(); ink-testing-library's Stdin stub
// lacks them. Patch prototype so the hook doesn't throw. (Copied from repl.spec.tsx.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = EventEmitter.prototype as any;
if (typeof proto.ref !== "function")
  proto.ref = function ref() {
    return this;
  };
if (typeof proto.unref !== "function")
  proto.unref = function unref() {
    return this;
  };

// -----------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------

const DB_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";

const FIXTURES_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "sweep",
  "tests",
  "fixtures",
);
const FALLBACK = "_swarm_fallback";
const SEED_TAG = "e2e-cli-repl-real";

let pool: Pool;
let redis: IORedis;
let db: ReturnType<typeof drizzle>;
let registry: CortexRegistry;
let adapters: Adapters;
let seededOperatorId: bigint;
let seededSatelliteId: bigint;
let seededCycleId: bigint;
let seededFindingId: bigint;

// -----------------------------------------------------------------------
// Setup / teardown
// -----------------------------------------------------------------------

beforeAll(async () => {
  process.env.THALAMUS_MODE = "fixtures";
  process.env.FIXTURES_DIR = FIXTURES_DIR;
  process.env.FIXTURES_FALLBACK = FALLBACK;

  pool = new Pool({ connectionString: DB_URL });
  db = drizzle(pool);
  redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  registry = new CortexRegistry();
  registry.discover();

  await cleanE2E();
  await seedFixture();

  adapters = await buildRealAdapters({
    // Pino logger + ring are exercised only by the logs adapter; the rest
    // take live DB/Redis/registry. Null-like stubs suffice here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ring: { snapshot: () => [] } as any,
    pool,
    redis,
    registry,
  });
}, 30_000);

afterAll(async () => {
  try {
    await cleanE2E();
  } finally {
    await redis?.quit().catch(() => undefined);
    await pool?.end().catch(() => undefined);
  }
}, 15_000);

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("CLI REPL — real adapters E2E", () => {
  it(
    "drives /explain <fid> through the live Postgres pool, renders a why-tree",
    async () => {
      const { stdin: rawStdin, lastFrame } = render(
        <App
          adapters={adapters}
          interpret={async () => ({
            plan: { steps: [], confidence: 0 },
            costUsd: 0,
          })}
          etaEstimate={() => ({ status: "estimating" as const })}
          etaRecord={() => {}}
        />,
      );
      // Bridge Ink 4 readable/read() to ink-testing-library's Stdin (same
      // pattern as repl.spec.tsx).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = rawStdin as any;
      let buf = "";
      s.read = () => {
        if (buf.length === 0) return null;
        const out = buf;
        buf = "";
        return out;
      };
      const writeChar = (data: string): void => {
        buf += data;
        s.emit("readable");
      };
      const typeLine = async (line: string): Promise<void> => {
        for (const ch of line) {
          writeChar(ch);
          await new Promise((r) => setTimeout(r, 2));
        }
        writeChar("\r");
      };

      await new Promise((r) => setTimeout(r, 50));
      await typeLine(`/explain ${seededFindingId}`);

      // Poll lastFrame up to 10s for the seeded finding title to appear.
      const deadline = Date.now() + 10_000;
      let frame = lastFrame() ?? "";
      while (Date.now() < deadline) {
        frame = lastFrame() ?? "";
        if (frame.includes(`${SEED_TAG}-finding-title`)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      // Proof-of-wiring assertions:
      //   1. The rendered frame is non-empty.
      //   2. It contains the seeded finding's title — which means the
      //      drizzle pool read researchFinding, the why adapter composed
      //      the tree, and the whyTree renderer painted it.
      expect(frame.length).toBeGreaterThan(0);
      expect(frame).toContain(`${SEED_TAG}-finding-title`);
    },
    15_000,
  );

  it(
    "drives /graph satellite:<id> through the live Postgres pool",
    async () => {
      const { stdin: rawStdin, lastFrame } = render(
        <App
          adapters={adapters}
          interpret={async () => ({
            plan: { steps: [], confidence: 0 },
            costUsd: 0,
          })}
          etaEstimate={() => ({ status: "estimating" as const })}
          etaRecord={() => {}}
        />,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = rawStdin as any;
      let buf = "";
      s.read = () => {
        if (buf.length === 0) return null;
        const out = buf;
        buf = "";
        return out;
      };
      const writeChar = (data: string): void => {
        buf += data;
        s.emit("readable");
      };
      const typeLine = async (line: string): Promise<void> => {
        for (const ch of line) {
          writeChar(ch);
          await new Promise((r) => setTimeout(r, 2));
        }
        writeChar("\r");
      };

      await new Promise((r) => setTimeout(r, 50));
      await typeLine(`/graph satellite:${seededSatelliteId}`);

      const deadline = Date.now() + 10_000;
      let frame = lastFrame() ?? "";
      while (Date.now() < deadline) {
        frame = lastFrame() ?? "";
        if (frame.includes(`satellite:${seededSatelliteId}`)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(frame).toContain(`satellite:${seededSatelliteId}`);
      // A finding edge was seeded — depth 1 should surface.
      expect(frame).toMatch(/finding:\d+/);
    },
    15_000,
  );
});

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

async function seedFixture(): Promise<void> {
  // 1 operator + 1 satellite
  const [opRow] = await db
    .insert(operator)
    .values({ name: `${SEED_TAG}-op`, slug: `${SEED_TAG}-op` })
    .returning({ id: operator.id });
  seededOperatorId = opRow!.id as bigint;

  const [satRow] = await db
    .insert(satellite)
    .values({
      name: `${SEED_TAG}-sat`,
      slug: `${SEED_TAG}-sat`,
      operatorId: seededOperatorId,
      launchYear: 2024,
    })
    .returning({ id: satellite.id });
  seededSatelliteId = satRow!.id as bigint;

  // 1 research_cycle + 1 finding + 1 edge pointing at the satellite
  const [cycleRow] = await db
    .insert(researchCycle)
    .values({
      triggerType: ResearchCycleTrigger.User,
      triggerSource: `${SEED_TAG}-trigger`,
      status: ResearchCycleStatus.Completed,
      findingsCount: 1,
      totalCost: 0,
      corticesUsed: [ResearchCortex.FleetAnalyst],
      dagPlan: {},
    })
    .returning({ id: researchCycle.id });
  seededCycleId = cycleRow!.id as bigint;

  const [findingRow] = await db
    .insert(researchFinding)
    .values({
      researchCycleId: seededCycleId,
      cortex: ResearchCortex.FleetAnalyst,
      findingType: ResearchFindingType.Insight,
      status: ResearchStatus.Active,
      title: `${SEED_TAG}-finding-title`,
      summary: `${SEED_TAG} seeded for CLI e2e`,
      evidence: [],
      confidence: 0.9,
      iteration: 1,
    })
    .returning({ id: researchFinding.id });
  seededFindingId = findingRow!.id as bigint;

  await db.insert(researchEdge).values({
    findingId: seededFindingId,
    entityType: ResearchEntityType.Satellite,
    entityId: seededSatelliteId,
    relation: ResearchRelation.About,
    weight: 1.0,
  });
}

async function cleanE2E(): Promise<void> {
  // Cascade the research tree, then drop the catalog rows.
  await db.execute(
    sql`DELETE FROM research_cycle WHERE trigger_source = ${`${SEED_TAG}-trigger`}`,
  );
  await db.execute(
    sql`DELETE FROM satellite WHERE slug LIKE ${`${SEED_TAG}%`}`,
  );
  await db.execute(
    sql`DELETE FROM operator WHERE slug LIKE ${`${SEED_TAG}%`}`,
  );
}

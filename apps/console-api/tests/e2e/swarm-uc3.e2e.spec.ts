/**
 * E2E — UC3 conjunction negotiation swarm.
 *
 * Exercises the full stack: sim_swarm → K sim_runs → inline turn loop →
 * aggregator → cluster report. Uses THALAMUS_MODE=fixtures with a fallback
 * fixture file (no live LLM calls, no API keys required).
 *
 * Prereqs:
 *   - thalamus-postgres docker container up on :5433 with migrations applied
 *   - thalamus-redis on :6380
 * Both are brought up by `make up`.
 */

import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql, eq } from "drizzle-orm";
import IORedis from "ioredis";
import { resolve } from "node:path";

import {
  simAgent,
  simAgentMemory,
  simRun,
  simSwarm,
  simTurn,
  operator,
  satellite,
  researchCycle,
  researchFinding,
  researchEdge,
} from "@interview/db-schema";
import { CortexRegistry } from "@interview/thalamus";

import {
  buildSweepContainer,
  SimSubjectHttpAdapter,
  SimHttpClient,
  SimQueueHttpAdapter,
  SimRuntimeStoreHttpAdapter,
  SimPromotionHttpClient,
  SimScenarioContextHttpAdapter,
  SimSwarmStoreHttpAdapter,
  createSwarmFishWorker,
  createSwarmAggregateWorker,
  setRedisClient,
  simTurnQueue,
  swarmFishQueue,
  swarmAggregateQueue,
  type SwarmAggregate,
  type DomainAuditProvider,
  type SweepPromotionAdapter,
  type ResolutionHandlerRegistry,
} from "@interview/sweep";
import { SsaPersonaComposer } from "../../src/agent/ssa/sim/persona-composer";
import { SsaPromptRenderer } from "../../src/agent/ssa/sim/prompt-renderer";
import { SsaCortexSelector } from "../../src/agent/ssa/sim/cortex-selector";
import { SsaActionSchemaProvider } from "../../src/agent/ssa/sim/action-schema";
import { SsaPerturbationPack } from "../../src/agent/ssa/sim/perturbation-pack";
import { SsaAggregationStrategy } from "../../src/agent/ssa/sim/aggregation-strategy";
import { SsaKindGuard } from "../../src/agent/ssa/sim/kind-guard";
import { PcAggregatorService } from "../../src/agent/ssa/sim/aggregators/pc";
import { TelemetryAggregatorService } from "../../src/agent/ssa/sim/aggregators/telemetry";
import { SsaSimOutcomeResolverService } from "../../src/services/ssa-sim-outcome-resolver.service";

// -----------------------------------------------------------------------
// Test config
// -----------------------------------------------------------------------

const DB_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";
const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";

const FIXTURES_DIR = resolve(__dirname, "..", "fixtures");

const disabledAuditProvider: DomainAuditProvider = {
  async runAudit(): Promise<never> {
    throw new Error(
      "UC3 E2E does not wire nano-sweep audit. Inject an app-owned audit port if needed.",
    );
  },
};
const disabledPromotionAdapter: SweepPromotionAdapter = {
  async promote(): Promise<never> {
    throw new Error(
      "UC3 E2E does not exercise sweep promotion. Inject SsaPromotionAdapter if needed.",
    );
  },
};
const disabledResolutionHandlers: ResolutionHandlerRegistry = {
  get: () => undefined,
  list: () => [],
};
const FALLBACK = "_swarm_fallback";
const SEED_TAG = "e2e-swarm-uc3";

let pool: Pool;
let redis: IORedis;
let db: ReturnType<typeof drizzle>;
let registry: CortexRegistry;
let fishWorker: ReturnType<typeof createSwarmFishWorker>;
let aggregateWorker: ReturnType<typeof createSwarmAggregateWorker>;
let container: ReturnType<typeof buildSweepContainer>;
let seededOperatorIds: number[] = [];

// -----------------------------------------------------------------------
// Setup / teardown
// -----------------------------------------------------------------------

beforeAll(async () => {
  // Env so runners go through fixture replay — no live API calls.
  process.env.THALAMUS_MODE = "fixtures";
  process.env.FIXTURES_DIR = FIXTURES_DIR;
  process.env.FIXTURES_FALLBACK = FALLBACK;

  pool = new Pool({ connectionString: DB_URL });
  db = drizzle(pool);
  redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  setRedisClient(redis);

  const skillsDir = resolve(
    __dirname,
    "../../src/agent/ssa/skills",
  );
  registry = new CortexRegistry(skillsDir);
  registry.discover();
  // Sanity: the sim cortex must be discoverable.
  if (!registry.get("sim_operator_agent")) {
    throw new Error(
      `sim_operator_agent skill not found in registry at ${skillsDir}`,
    );
  }

  // Clean any previous e2e leftovers before seeding (DB + BullMQ queues).
  await cleanE2E();
  await drainQueues().catch((): void => {
    // Setup cleanup is best-effort in e2e.
  });
  seededOperatorIds = await seedOperators();

  const ssaPersona = new SsaPersonaComposer();
  const ssaPrompt = new SsaPromptRenderer();
  const ssaCortexSelector = new SsaCortexSelector();
  const ssaSchema = new SsaActionSchemaProvider();
  const ssaPerturbationPack = new SsaPerturbationPack();
  const ssaAggStrategy = new SsaAggregationStrategy();
  const ssaKindGuard = new SsaKindGuard();
  const simHttp = new SimHttpClient(createFetchSimTransport(BASE));
  const queue = new SimQueueHttpAdapter(simHttp, {
    kernelSecret: process.env.SIM_KERNEL_SHARED_SECRET,
  });
  const runtimeStore = new SimRuntimeStoreHttpAdapter(simHttp);
  const swarmStore = new SimSwarmStoreHttpAdapter(simHttp);
  const subjects = new SimSubjectHttpAdapter(simHttp);
  const scenarioContext = new SimScenarioContextHttpAdapter(simHttp);
  const promotion = new SimPromotionHttpClient(simHttp, {
    kernelSecret: process.env.SIM_KERNEL_SHARED_SECRET,
  });
  const telemetryAggregator = new TelemetryAggregatorService({ swarmStore });
  const pcAggregator = new PcAggregatorService({ swarmStore });

  container = buildSweepContainer({
    redis,
    ports: {
      audit: disabledAuditProvider,
      promotion: disabledPromotionAdapter,
      resolutionHandlers: disabledResolutionHandlers,
    },
    sim: {
      cortexRegistry: registry,
      // Embed stub: return null so memory falls back to recency (deterministic
      // without Voyage, suitable for e2e). Aggregator falls back to action-kind
      // bucketing when fewer than 2 vectors, which works for size=3 swarms.
      embed: async () => null,
      llmMode: "fixtures",
      queue,
      runtimeStore,
      swarmStore,
      subjects,
      scenarioContext,
      persona: ssaPersona,
      prompt: ssaPrompt,
      cortexSelector: ssaCortexSelector,
      schemaProvider: ssaSchema,
      perturbationPack: ssaPerturbationPack,
      aggStrategy: ssaAggStrategy,
      kindGuard: ssaKindGuard,
    },
  });
  // Spin up workers.
  fishWorker = createSwarmFishWorker({
    store: runtimeStore,
    swarmService: container.sim!.swarmService,
    sequentialRunner: container.sim!.sequentialRunner,
    dagRunner: container.sim!.dagRunner,
    kindGuard: ssaKindGuard,
    concurrency: 4,
  });
  const outcomeResolver = new SsaSimOutcomeResolverService({
    aggregator: container.sim!.aggregator,
    telemetryAggregator,
    pcAggregator,
    promotionService: {
      emitSuggestionFromModal: async (swarmId, aggregate) => {
        await promotion.emitSuggestionFromModal({ swarmId, aggregate });
        return null;
      },
          emitTelemetrySuggestions: async (aggregate) => {
            await promotion.emitScalarSuggestions({
              swarmId: aggregate.swarmId,
              aggregate,
            });
            return [];
          },
    },
  });
  aggregateWorker = createSwarmAggregateWorker({
    swarmStore,
    resolver: outcomeResolver,
    concurrency: 1,
  });

  // Wait for workers to be ready (BullMQ emits 'ready' on connect).
  await Promise.all([fishWorker.waitUntilReady(), aggregateWorker.waitUntilReady()]);
}, 30_000);

afterAll(async () => {
  try {
    await drainQueues().catch((): void => {
      // Teardown best-effort in e2e cleanup.
    });
    await fishWorker?.close().catch((): void => {
      // Teardown best-effort in e2e cleanup.
    });
    await aggregateWorker?.close().catch((): void => {
      // Teardown best-effort in e2e cleanup.
    });
  } finally {
    await redis?.quit().catch((): void => {
      // Teardown best-effort in e2e cleanup.
    });
    await pool?.end().catch((): void => {
      // Teardown best-effort in e2e cleanup.
    });
  }
}, 15_000);

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("UC3 swarm — E2E", () => {
  it(
    "launches 3 fish, drains turns via fixture fallback, aggregates to a non-empty distribution",
    async () => {
      const sv = container.sim!.swarmService;

      const launch = await sv.launchSwarm({
        kind: "uc3_conjunction",
        title: `${SEED_TAG} swarm`,
        baseSeed: {
          subjectIds: seededOperatorIds.slice(0, 2),
          subjectKind: "operator",
          horizonDays: 2,
          turnsPerDay: 1,
        },
        perturbations: [
          { kind: "noop" },
          {
            kind: "persona_tweak",
            agentIndex: 0,
            riskProfile: "aggressive",
          },
          {
            kind: "delta_v_budget",
            agentIndex: 1,
            maxPerSat: 20,
          },
        ],
        config: {
          llmMode: "fixtures",
          quorumPct: 0.66,
          perFishTimeoutMs: 60_000,
          fishConcurrency: 4,
          nanoModel: "gpt-5.4-nano",
          seed: 42,
        },
      });

      expect(launch.swarmId).toBeGreaterThan(0);
      expect(launch.fishCount).toBe(3);

      // Wait for swarm.status in {done, failed}. 60s timeout (vs the happy-path
      // ~400ms) absorbs BullMQ/Redis/Pool startup contention when this spec is
      // run in the full vitest suite alongside 200+ other tests.
      const finalStatus = await waitForSwarmDone(launch.swarmId, 60_000);
      expect(["done", "failed"]).toContain(finalStatus.status);
      expect(finalStatus.status).toBe("done");

      // Assertions — structural, not model-specific.
      const counts = await fishStatusCounts(launch.swarmId);
      expect(counts.done).toBeGreaterThanOrEqual(2); // >= 66% quorum of 3
      expect(counts.pending).toBe(0);

      // Every fish has agents + turns.
      const agentCount = await countRows(
        sql`SELECT count(*)::int AS c
            FROM sim_agent a
            JOIN sim_run r ON r.id = a.sim_run_id
            WHERE r.swarm_id = ${BigInt(launch.swarmId)}`,
      );
      expect(agentCount).toBe(6); // 3 fish × 2 agents

      const turnCount = await countRows(
        sql`SELECT count(*)::int AS c
            FROM sim_turn t
            JOIN sim_run r ON r.id = t.sim_run_id
            WHERE r.swarm_id = ${BigInt(launch.swarmId)} AND t.actor_kind = 'agent'`,
      );
      expect(turnCount).toBeGreaterThanOrEqual(3); // at least one agent turn per fish

      // Memory rows are scoped: no cross-fish bleed.
      const bleed = await countRows(
        sql`SELECT count(*)::int AS c
            FROM sim_agent_memory m
            JOIN sim_agent a ON a.id = m.agent_id
            WHERE m.sim_run_id <> a.sim_run_id`,
      );
      expect(bleed).toBe(0);

      // Aggregator output stored on the swarm.
      const swarmRow = await db
        .select({ config: simSwarm.config, status: simSwarm.status })
        .from(simSwarm)
        .where(eq(simSwarm.id, BigInt(launch.swarmId)))
        .limit(1)
        .then((rows) => rows[0]);
      expect(swarmRow).toBeDefined();
      const aggregate = (swarmRow!.config as { aggregate?: SwarmAggregate }).aggregate;
      expect(aggregate).toBeDefined();
      expect(aggregate!.quorumMet).toBe(true);
      expect(aggregate!.clusters.length).toBeGreaterThanOrEqual(1);

      // A cluster must cover every successful fish.
      const coveredFish = new Set<number>();
      for (const c of aggregate!.clusters) {
        for (const idx of c.memberFishIndexes) coveredFish.add(idx);
      }
      expect(coveredFish.size).toBe(counts.done);

      // Divergence score is a valid probability.
      expect(aggregate!.divergenceScore).toBeGreaterThanOrEqual(0);
      expect(aggregate!.divergenceScore).toBeLessThanOrEqual(1);

      // ---------------------------------------------------------------
      // Phase 5 — closing the loop: modal outcome emitted as a suggestion
      // ---------------------------------------------------------------
      expect(aggregate!.modal).not.toBeNull();
      expect(aggregate!.modal!.actionKind).toBe("maneuver");
      expect(aggregate!.modal!.fraction).toBeGreaterThanOrEqual(0.5);

      // sim_swarm.suggestion_id is set by the aggregate worker.
      const finalSwarm = await db
        .select({
          suggestionId: simSwarm.suggestionId,
          status: simSwarm.status,
        })
        .from(simSwarm)
        .where(eq(simSwarm.id, BigInt(launch.swarmId)))
        .limit(1)
        .then((rows) => rows[0]);
      expect(finalSwarm?.suggestionId).not.toBeNull();

      // Read back the suggestion via the sweep repository.
      const suggestionId = String(finalSwarm!.suggestionId);
      const suggestion = await container.sweepRepo.getById(suggestionId);
      expect(suggestion).not.toBeNull();
      expect(suggestion!.simSwarmId).toBe(String(launch.swarmId));

      // Modal action payload is a maneuver.
      const resolution = JSON.parse(suggestion!.resolutionPayload ?? "null") as {
        kind: string;
        swarmId: number;
        action: { kind: string; satelliteId?: number };
      } | null;
      expect(resolution).not.toBeNull();
      expect(resolution!.kind).toBe("sim_swarm_modal");
      expect(resolution!.swarmId).toBe(launch.swarmId);
      expect(resolution!.action.kind).toBe("maneuver");

      // Full distribution stored on the suggestion for reviewer context.
      const distribution = JSON.parse(suggestion!.simDistribution ?? "null") as {
        swarmId: number;
        totalFish: number;
        succeededFish: number;
        modal: { actionKind: string; fraction: number };
        clusters: Array<{ label: string; fraction: number; memberFishIndexes: number[] }>;
      } | null;
      expect(distribution).not.toBeNull();
      expect(distribution!.totalFish).toBe(3);
      expect(distribution!.succeededFish).toBe(counts.done);
      expect(distribution!.modal.actionKind).toBe("maneuver");
      expect(distribution!.modal.fraction).toBeGreaterThanOrEqual(0.5);
      expect(distribution!.clusters.length).toBeGreaterThanOrEqual(1);

      // The suggestion is indexed in the pending queue — a reviewer will see it.
      // Lookup by ID is O(1) and immune to dev-shared-Redis stale entries that
      // would push the freshly-emitted suggestion past any list() pagination.
      const found = await container.sweepRepo.getById(suggestionId);
      expect(found).not.toBeNull();
      expect(["critical", "warning"]).toContain(
        String(found!.domainFields.severity ?? ""),
      );
      expect(found!.reviewedAt).toBeNull();

      // ---------------------------------------------------------------
      // KG audit — swarm modal produces a research_cycle + finding + edge
      // ---------------------------------------------------------------
      const finalSwarmWithFinding = await db
        .select({
          reportFindingId: simSwarm.outcomeReportFindingId,
        })
        .from(simSwarm)
        .where(eq(simSwarm.id, BigInt(launch.swarmId)))
        .limit(1)
        .then((rows) => rows[0]);
      expect(finalSwarmWithFinding?.reportFindingId).not.toBeNull();

      const findingId = finalSwarmWithFinding!.reportFindingId!;
      const finding = await db
        .select()
        .from(researchFinding)
        .where(eq(researchFinding.id, findingId))
        .limit(1)
        .then((rows) => rows[0]);
      expect(finding).toBeDefined();
      expect(finding!.cortex).toBe("conjunction_analysis");
      expect(finding!.confidence).toBeGreaterThanOrEqual(0.5);

      const cycle = await db
        .select()
        .from(researchCycle)
        .where(eq(researchCycle.id, finding!.researchCycleId))
        .limit(1)
        .then((rows) => rows[0]);
      expect(cycle).toBeDefined();
      expect(cycle!.triggerSource).toBe(`sim_swarm:${launch.swarmId}`);
      expect(cycle!.findingsCount).toBe(1);

      const edges = await db
        .select()
        .from(researchEdge)
        .where(eq(researchEdge.findingId, findingId));
      expect(edges.length).toBeGreaterThanOrEqual(1);
      expect(edges[0].entityType).toBe("satellite");
    },
    90_000,
  );
});

function createFetchSimTransport(baseUrl: string) {
  return {
    async request(input: {
      method: "GET" | "POST" | "PATCH";
      path: string;
      query?: Record<string, string | number | boolean | null | undefined>;
      json?: unknown;
      headers?: Record<string, string>;
    }) {
      const url = new URL(input.path, baseUrl);
      for (const [key, value] of Object.entries(input.query ?? {})) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
      const res = await fetch(url, {
        method: input.method,
        headers: input.json === undefined
          ? input.headers
          : { "content-type": "application/json", ...(input.headers ?? {}) },
        body: input.json === undefined ? undefined : JSON.stringify(input.json),
      });
      const text = await res.text();
      return {
        status: res.status,
        body: text.length > 0 ? JSON.parse(text) : {},
      };
    },
  };
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

async function waitForSwarmDone(
  swarmId: number,
  timeoutMs: number,
): Promise<{ status: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await db
      .select({ status: simSwarm.status })
      .from(simSwarm)
      .where(eq(simSwarm.id, BigInt(swarmId)))
      .limit(1)
      .then((rows) => rows[0]);
    if (row && (row.status === "done" || row.status === "failed")) {
      return { status: row.status };
    }
    await sleep(300);
  }
  throw new Error(`swarm ${swarmId} did not finish within ${timeoutMs}ms`);
}

async function fishStatusCounts(
  swarmId: number,
): Promise<{ done: number; failed: number; pending: number; running: number }> {
  const rows = await db.execute(sql`
    SELECT status, count(*)::int AS c
    FROM sim_run WHERE swarm_id = ${BigInt(swarmId)}
    GROUP BY status
  `);
  const out = { done: 0, failed: 0, pending: 0, running: 0 };
  for (const r of rows.rows as Array<{ status: keyof typeof out; c: number }>) {
    if (r.status in out) out[r.status] = r.c;
  }
  return out;
}

async function countRows(q: ReturnType<typeof sql>): Promise<number> {
  const res = await db.execute(q);
  const row = res.rows[0] as { c?: number } | undefined;
  return row?.c ?? 0;
}

async function seedOperators(): Promise<number[]> {
  // Insert 2 operators + 2 satellites each so the fleet snapshot has content.
  const opRows = await db
    .insert(operator)
    .values([
      { name: `${SEED_TAG}-alpha`, slug: `${SEED_TAG}-alpha` },
      { name: `${SEED_TAG}-beta`, slug: `${SEED_TAG}-beta` },
    ])
    .returning({ id: operator.id });

  const ids = opRows.map((r) => Number(r.id));

  for (const opId of ids) {
    await db.insert(satellite).values([
      {
        name: `${SEED_TAG}-${opId}-sat1`,
        slug: `${SEED_TAG}-${opId}-sat1`,
        operatorId: BigInt(opId),
        launchYear: 2022,
      },
      {
        name: `${SEED_TAG}-${opId}-sat2`,
        slug: `${SEED_TAG}-${opId}-sat2`,
        operatorId: BigInt(opId),
        launchYear: 2023,
      },
    ]);
  }
  return ids;
}

async function cleanE2E(): Promise<void> {
  // Cascade from sim_swarm + operator. Also clear research_cycle rows tagged
  // with our swarm prefix so findings/edges drop cleanly.
  await db.execute(sql`
    DELETE FROM research_cycle WHERE trigger_source LIKE 'sim_swarm:%'
  `);
  await db.execute(sql`
    DELETE FROM sim_swarm
    WHERE title LIKE ${`${SEED_TAG}%`}
  `);
  await db.execute(sql`DELETE FROM satellite WHERE slug LIKE ${`${SEED_TAG}%`}`);
  await db.execute(sql`DELETE FROM operator WHERE slug LIKE ${`${SEED_TAG}%`}`);

  // Redis cleanup — scan IDX_PENDING and drop entries whose hash is gone
  // (stale TTL expiries leaving dangling IDs) or whose sim_swarm parent has
  // been purged above. Keeps the reviewer queue consistent with the DB.
  await cleanE2ERedis();
}

async function cleanE2ERedis(): Promise<void> {
  const IDX_PENDING = "sweep:index:pending";
  const PREFIX = "sweep:suggestions";
  const pending = await redis.smembers(IDX_PENDING);
  if (pending.length === 0) return;

  const pipe = redis.pipeline();
  for (const id of pending) pipe.hgetall(`${PREFIX}:${id}`);
  const results = (await pipe.exec()) ?? [];

  const toDrop: string[] = [];
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i]!;
    const [err, data] = results[i] ?? [null, null];
    if (err) continue;
    const d = (data as Record<string, string> | null) ?? {};
    // Stale: no backing hash anymore.
    if (!d.id) {
      toDrop.push(id);
      continue;
    }
    // Dangling: hash references a sim_swarm we just deleted.
    if (d.simSwarmId) {
      const rows = await db.execute(sql`
        SELECT id FROM sim_swarm WHERE id = ${BigInt(d.simSwarmId)}
      `);
      if (rows.rows.length === 0) {
        toDrop.push(id);
        // Also evict the hash body.
        await redis.del(`${PREFIX}:${id}`);
      }
    }
  }
  if (toDrop.length > 0) {
    await redis.srem(IDX_PENDING, ...toDrop);
  }
}

async function drainQueues(): Promise<void> {
  const wipeQueueKeys = async (prefix: string): Promise<void> => {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", "200");
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  };

  await Promise.all([
    wipeQueueKeys("bull:sim-turn"),
    wipeQueueKeys("bull:swarm-fish"),
    wipeQueueKeys("bull:swarm-aggregate"),
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

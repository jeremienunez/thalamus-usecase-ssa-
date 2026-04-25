import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import IORedis from "ioredis";
import {
  DEFAULT_THALAMUS_TRANSPORT_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";

import {
  operator,
  researchCycle,
  satellite,
  satelliteBus,
  simRun,
  simSwarm,
} from "@interview/db-schema";
import {
  CortexRegistry,
  setThalamusTransportConfigProvider,
} from "@interview/thalamus";
import {
  buildSweepContainer,
  type DomainAuditProvider,
  type ResolutionHandlerRegistry,
  SimHttpClient,
  SimPromotionHttpClient,
  SimQueueHttpAdapter,
  SimRuntimeStoreHttpAdapter,
  SimScenarioContextHttpAdapter,
  SimSubjectHttpAdapter,
  SimSwarmStoreHttpAdapter,
  type SweepPromotionAdapter,
  setRedisClient,
} from "@interview/sweep";
import {
  createSwarmAggregateWorker,
  createSwarmFishWorker,
  simTurnQueue,
  swarmAggregateQueue,
  swarmFishQueue,
} from "@interview/sweep/internal";
import { SsaActionSchemaProvider } from "../../src/agent/ssa/sim/action-schema";
import { SsaAggregationStrategy } from "../../src/agent/ssa/sim/aggregation-strategy";
import { SsaCortexSelector } from "../../src/agent/ssa/sim/cortex-selector";
import { SsaKindGuard } from "../../src/agent/ssa/sim/kind-guard";
import { SsaPersonaComposer } from "../../src/agent/ssa/sim/persona-composer";
import { SsaPerturbationPack } from "../../src/agent/ssa/sim/perturbation-pack";
import { SsaPromptRenderer } from "../../src/agent/ssa/sim/prompt-renderer";
import { PcAggregatorService } from "../../src/agent/ssa/sim/aggregators/pc";
import { TelemetryAggregatorService } from "../../src/agent/ssa/sim/aggregators/telemetry";
import { SsaSimOutcomeResolverService } from "../../src/services/ssa-sim-outcome-resolver.service";
import { DEFAULT_SIM_KERNEL_SHARED_SECRET } from "../../src/server";
import {
  cleanupConjunctionFixture,
  CONJUNCTION_ID,
  seedConjunctionFixture,
} from "./helpers/db-fixtures";

const DB_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";
const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";
const KERNEL_SECRET =
  process.env.SIM_KERNEL_SHARED_SECRET ?? DEFAULT_SIM_KERNEL_SHARED_SECRET;
const FIXTURES_DIR = resolve(__dirname, "..", "fixtures");
const TELEMETRY_FALLBACK = "_telemetry_swarm_fallback";
const PC_FALLBACK = "_pc_swarm_fallback";
const SEED_TAG = "e2e-telemetry-swarm";

const disabledAuditProvider: DomainAuditProvider = {
  async runAudit(): Promise<never> {
    throw new Error(
      "Telemetry E2E does not wire nano-sweep audit. Inject an app-owned audit port if needed.",
    );
  },
};
const disabledPromotionAdapter: SweepPromotionAdapter = {
  async promote(): Promise<never> {
    throw new Error(
      "Telemetry E2E does not exercise sweep promotion. Inject SsaPromotionAdapter if needed.",
    );
  },
};
const disabledResolutionHandlers: ResolutionHandlerRegistry = {
  get: () => undefined,
  list: () => [],
};

let pool: Pool;
let redis: IORedis;
let db: ReturnType<typeof drizzle>;
let registry: CortexRegistry;
let fishWorker: ReturnType<typeof createSwarmFishWorker>;
let aggregateWorker: ReturnType<typeof createSwarmAggregateWorker>;
let container: ReturnType<typeof buildSweepContainer>;
let targetSatelliteId: number;

beforeAll(async () => {
  process.env.THALAMUS_MODE = "fixtures";
  process.env.FIXTURES_DIR = FIXTURES_DIR;
  process.env.FIXTURES_FALLBACK = TELEMETRY_FALLBACK;
  useFixtureFallback(TELEMETRY_FALLBACK);

  pool = new Pool({ connectionString: DB_URL });
  db = drizzle(pool);
  redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  setRedisClient(redis);

  const skillsDir = resolve(__dirname, "../../src/agent/ssa/skills");
  registry = new CortexRegistry(skillsDir);
  registry.discover();
  for (const skillName of [
    "sim_operator_agent",
    "telemetry_inference_agent",
    "pc_estimator_agent",
  ]) {
    if (registry.get(skillName)) continue;
    throw new Error(
      `${skillName} skill not found in registry at ${skillsDir}`,
    );
  }

  await cleanE2E();
  await drainQueues().catch((): void => undefined);
  targetSatelliteId = await seedTelemetryTarget();
  const fixtureClient = await pool.connect();
  try {
    await seedConjunctionFixture(fixtureClient);
  } finally {
    fixtureClient.release();
  }

  const ssaPersona = new SsaPersonaComposer();
  const ssaPrompt = new SsaPromptRenderer();
  const ssaCortexSelector = new SsaCortexSelector();
  const ssaSchema = new SsaActionSchemaProvider();
  const ssaPerturbationPack = new SsaPerturbationPack();
  const ssaAggStrategy = new SsaAggregationStrategy();
  const ssaKindGuard = new SsaKindGuard();
  const simHttp = new SimHttpClient(createFetchSimTransport(BASE));
  const queue = new SimQueueHttpAdapter(simHttp, {
    kernelSecret: KERNEL_SECRET,
  });
  const runtimeStore = new SimRuntimeStoreHttpAdapter(simHttp);
  const swarmStore = new SimSwarmStoreHttpAdapter(simHttp);
  const subjects = new SimSubjectHttpAdapter(simHttp);
  const scenarioContext = new SimScenarioContextHttpAdapter(simHttp);
  const promotion = new SimPromotionHttpClient(simHttp, {
    kernelSecret: KERNEL_SECRET,
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

  await Promise.all([
    fishWorker.waitUntilReady(),
    aggregateWorker.waitUntilReady(),
  ]);
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
    await cleanE2E().catch((): void => {
      // Teardown best-effort in e2e cleanup.
    });
    const fixtureClient = await pool?.connect().catch((): null => null);
    if (fixtureClient) {
      try {
        await cleanupConjunctionFixture(fixtureClient);
      } finally {
        fixtureClient.release();
      }
    }
  } finally {
    await redis?.quit().catch((): void => {
      // Teardown best-effort in e2e cleanup.
    });
    await pool?.end().catch((): void => {
      // Teardown best-effort in e2e cleanup.
    });
  }
}, 15_000);

describe("Telemetry swarm — E2E", () => {
  it(
    "launches via HTTP, aggregates infer_telemetry fish, and emits HTTP-backed promotion suggestions",
    async () => {
      const res = await fetch(`${BASE}/api/sim/telemetry/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          satelliteId: String(targetSatelliteId),
          fishCount: 5,
          config: {
            llmMode: "fixtures",
            quorumPct: 0.6,
            perFishTimeoutMs: 60_000,
            fishConcurrency: 4,
            nanoModel: "gpt-5.4-nano",
            seed: 42,
          },
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        swarmId: string;
        fishCount: number;
        firstSimRunId: string;
      };
      const swarmId = Number(body.swarmId);
      expect(body.fishCount).toBe(5);
      expect(Number(body.firstSimRunId)).toBeGreaterThan(0);

      const finalStatus = await waitForSwarmDone(swarmId, 60_000);
      expect(finalStatus.status).toBe("done");

      const counts = await fishStatusCounts(swarmId);
      expect(counts.done).toBe(5);
      expect(counts.failed).toBe(0);

      const swarmRow = await db
        .select({
          status: simSwarm.status,
          suggestionId: simSwarm.suggestionId,
          config: simSwarm.config,
        })
        .from(simSwarm)
        .where(eq(simSwarm.id, BigInt(swarmId)))
        .limit(1)
        .then((rows) => rows[0]);
      expect(swarmRow?.status).toBe("done");
      expect(swarmRow?.suggestionId).not.toBeNull();
      expect(
        (swarmRow?.config as { telemetryAggregate?: unknown } | undefined)
          ?.telemetryAggregate,
      ).toBeTruthy();

      const suggestion = await container.sweepRepo.getById(
        String(swarmRow!.suggestionId),
      );
      expect(suggestion).not.toBeNull();
      expect(suggestion!.simSwarmId).toBe(String(swarmId));

      const suggestions = await listPendingSuggestionsForSwarm(swarmId);
      expect(suggestions.length).toBe(8);
      expect(new Set(suggestions.map((row) => row.category))).toEqual(
        new Set(["enrichment"]),
      );
      expect(
        suggestions.every((row) =>
          row.resolutionPayload?.includes("\"kind\":\"update_field\""),
        ),
      ).toBe(true);

      const researchCycles = await countRows(sql`
        SELECT count(*)::int AS c
        FROM research_cycle
        WHERE trigger_source = ${`sim_swarm:${swarmId}`}
      `);
      expect(researchCycles).toBe(0);

      const targetRow = await db
        .select({
          powerDraw: satellite.powerDraw,
          thermalMargin: satellite.thermalMargin,
          pointingAccuracy: satellite.pointingAccuracy,
          attitudeRate: satellite.attitudeRate,
          linkBudget: satellite.linkBudget,
          dataRate: satellite.dataRate,
          payloadDuty: satellite.payloadDuty,
          eclipseRatio: satellite.eclipseRatio,
        })
        .from(satellite)
        .where(eq(satellite.id, BigInt(targetSatelliteId)))
        .limit(1)
        .then((rows) => rows[0]);
      expect(targetRow).toEqual({
        powerDraw: null,
        thermalMargin: null,
        pointingAccuracy: null,
        attitudeRate: null,
        linkBudget: null,
        dataRate: null,
        payloadDuty: null,
        eclipseRatio: null,
      });
    },
    90_000,
  );

  it(
    "launches PC via HTTP, aggregates estimate_pc fish, and snapshots pcAggregate",
    async () => {
      useFixtureFallback(PC_FALLBACK);

      const res = await fetch(`${BASE}/api/sim/pc/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conjunctionId: String(CONJUNCTION_ID),
          fishCount: 4,
          config: {
            llmMode: "fixtures",
            quorumPct: 0.5,
            perFishTimeoutMs: 60_000,
            fishConcurrency: 2,
            nanoModel: "gpt-5.4-nano",
            seed: 84,
          },
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        swarmId: string;
        conjunctionId: string;
        fishCount: number;
      };
      const swarmId = Number(body.swarmId);
      expect(body.conjunctionId).toBe(String(CONJUNCTION_ID));
      expect(body.fishCount).toBe(4);

      const finalStatus = await waitForSwarmDone(swarmId, 60_000);
      expect(finalStatus.status).toBe("done");

      const counts = await fishStatusCounts(swarmId);
      expect(counts.done).toBe(4);
      expect(counts.failed).toBe(0);

      const swarmRow = await db
        .select({
          status: simSwarm.status,
          config: simSwarm.config,
        })
        .from(simSwarm)
        .where(eq(simSwarm.id, BigInt(swarmId)))
        .limit(1)
        .then((rows) => rows[0]);
      expect(swarmRow?.status).toBe("done");
      const pcAggregate = (
        swarmRow?.config as { pcAggregate?: { fishCount?: number; medianPc?: number } }
      )?.pcAggregate;
      expect(pcAggregate).toBeTruthy();
      expect(pcAggregate?.fishCount).toBe(4);
      expect(pcAggregate?.medianPc).toBe(0.00021);
    },
    90_000,
  );
});

function useFixtureFallback(fallbackFixture: string): void {
  setThalamusTransportConfigProvider(
    new StaticConfigProvider({
      ...DEFAULT_THALAMUS_TRANSPORT_CONFIG,
      mode: "fixtures",
      fixturesDir: FIXTURES_DIR,
      fallbackFixture,
    }),
  );
}

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
): Promise<{ done: number; failed: number; timeout: number; pending: number; running: number }> {
  const rows = await db.execute(sql`
    SELECT status, count(*)::int AS c
    FROM sim_run WHERE swarm_id = ${BigInt(swarmId)}
    GROUP BY status
  `);
  const out = { done: 0, failed: 0, timeout: 0, pending: 0, running: 0 };
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

async function listPendingSuggestionsForSwarm(
  swarmId: number,
): Promise<
  Array<{
    id: string;
    category: string;
    resolutionPayload: string | null;
  }>
> {
  const ids = await redis.smembers("sweep:index:pending");
  if (ids.length === 0) return [];

  const pipe = redis.pipeline();
  for (const id of ids) {
    pipe.hgetall(`sweep:suggestions:${id}`);
  }
  const results = (await pipe.exec()) ?? [];

  const rows: Array<{
    id: string;
    category: string;
    resolutionPayload: string | null;
  }> = [];
  for (const [err, data] of results) {
    if (err || !data || typeof data !== "object") continue;
    const row = data as Record<string, string>;
    if (row.simSwarmId !== String(swarmId)) continue;
    rows.push({
      id: row.id,
      category: row.category,
      resolutionPayload: row.resolutionPayload || null,
    });
  }
  return rows;
}

async function seedTelemetryTarget(): Promise<number> {
  const [opRow] = await db
    .insert(operator)
    .values({
      name: `${SEED_TAG}-operator`,
      slug: `${SEED_TAG}-operator`,
    })
    .returning({ id: operator.id });
  if (!opRow) {
    throw new Error("failed to insert telemetry test operator");
  }

  const busRow = await db
    .select({ id: satelliteBus.id })
    .from(satelliteBus)
    .where(eq(satelliteBus.name, "SSL-1300"))
    .limit(1)
    .then((rows) => rows[0]);
  const busId =
    busRow?.id ??
    (
      await db
        .insert(satelliteBus)
        .values({ name: "SSL-1300" })
        .returning({ id: satelliteBus.id })
    )[0]?.id;
  if (!busId) {
    throw new Error("failed to resolve SSL-1300 bus row");
  }

  const [satRow] = await db
    .insert(satellite)
    .values({
      name: `${SEED_TAG}-sat`,
      slug: `${SEED_TAG}-sat`,
      operatorId: opRow.id,
      satelliteBusId: busId,
      launchYear: 2024,
    })
    .returning({ id: satellite.id });
  if (!satRow) {
    throw new Error("failed to insert telemetry test satellite");
  }
  return Number(satRow.id);
}

async function cleanE2E(): Promise<void> {
  await db.execute(sql`
    DELETE FROM research_cycle rc
    USING sim_swarm s
    WHERE rc.trigger_source = ('sim_swarm:' || s.id::text)
      AND s.title LIKE ${`uc_telemetry:%:${SEED_TAG}%`}
  `);
  await db.execute(sql`
    DELETE FROM sim_run r
    USING sim_agent a, operator o
    WHERE r.id = a.sim_run_id
      AND a.operator_id = o.id
      AND o.slug LIKE ${`${SEED_TAG}%`}
  `);
  await db.execute(sql`
    DELETE FROM sim_run r
    USING sim_swarm s
    WHERE r.swarm_id = s.id
      AND s.title = ${`uc_pc_estimator:${CONJUNCTION_ID}`}
  `);
  await db.execute(sql`
    DELETE FROM sim_swarm
    WHERE title LIKE ${`uc_telemetry:%:${SEED_TAG}%`}
       OR title = ${`uc_pc_estimator:${CONJUNCTION_ID}`}
  `);
  await db.execute(sql`DELETE FROM satellite WHERE slug LIKE ${`${SEED_TAG}%`}`);
  await db.execute(sql`DELETE FROM operator WHERE slug LIKE ${`${SEED_TAG}%`}`);
  await cleanE2ERedis();
}

async function cleanE2ERedis(): Promise<void> {
  const idxPending = "sweep:index:pending";
  const prefix = "sweep:suggestions";
  const pending = await redis.smembers(idxPending);
  if (pending.length === 0) return;

  const pipe = redis.pipeline();
  for (const id of pending) pipe.hgetall(`${prefix}:${id}`);
  const results = (await pipe.exec()) ?? [];

  const toDrop: string[] = [];
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i]!;
    const [err, data] = results[i] ?? [null, null];
    if (err) continue;
    const d = (data as Record<string, string> | null) ?? {};
    if (!d.id) {
      toDrop.push(id);
      continue;
    }
    if (d.simSwarmId) {
      const rows = await db.execute(sql`
        SELECT id FROM sim_swarm WHERE id = ${BigInt(d.simSwarmId)}
      `);
      if (rows.rows.length === 0) {
        toDrop.push(id);
        await redis.del(`${prefix}:${id}`);
      }
    }
  }
  if (toDrop.length > 0) {
    await redis.srem(idxPending, ...toDrop);
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import React from "react";
import { render } from "ink";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { Pool } from "pg";
import IORedis from "ioredis";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";

import { App } from "./app";
import { EtaStore } from "./util/etaStore";
import { PinoRingBuffer } from "./util/pinoRingBuffer";
import { LogsAdapter } from "./adapters/logs";
import { interpret } from "./router/interpreter";
import type { Adapters } from "./router/dispatch";

import {
  CortexRegistry,
  buildThalamusContainer,
  callNanoWithMode,
} from "@interview/thalamus";
import { buildSweepContainer } from "@interview/sweep";
// Plan 2 · B.10: startTelemetrySwarm moved to console-api SSA pack. Plan 3
// will rewire this CLI path via POST /api/sim/telemetry/start. Until then
// CLI telemetry.start throws at runtime (see telemetry adapter below).
import {
  researchCycle,
  researchFinding,
  researchEdge,
  sourceItem,
  type Database,
} from "@interview/db-schema";
import { ResearchCycleTrigger } from "@interview/shared/enum";

export interface BootDeps {
  adapters: Adapters;
  nano: {
    call: (args: {
      system: string;
      user: string;
      temperature: number;
      responseFormat: "json";
    }) => Promise<{ content: string; costUsd: number }>;
  };
}

/**
 * Pre-built wiring context (injected by tests; auto-constructed in prod).
 * When `deps.wiring` is provided, main() uses those deps instead of opening
 * its own Pool/Redis — this is how the e2e spec shares a DB connection with
 * the test fixture seed/teardown.
 */
export interface BootWiring {
  pool: Pool;
  redis: IORedis;
  registry: CortexRegistry;
}

export async function main(
  deps?: Partial<BootDeps> & { wiring?: BootWiring },
): Promise<void> {
  const eta = new EtaStore(join(homedir(), ".cache/ssa-cli/eta.json"));
  process.on("exit", () => eta.flush());

  const ring = new PinoRingBuffer(1_000);
  const write = (s: string): void => {
    try {
      ring.push(JSON.parse(s));
    } catch {
      /* non-json ignored */
    }
  };
  const logger = pino({ level: "info" }, { write });

  let wiring = deps?.wiring;
  let ownedPool: Pool | undefined;
  let ownedRedis: IORedis | undefined;
  if (!wiring && !deps?.adapters) {
    const databaseUrl =
      process.env.DATABASE_URL ??
      "postgres://thalamus:thalamus@localhost:5433/thalamus";
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";
    ownedPool = new Pool({ connectionString: databaseUrl });
    ownedRedis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    // SSA cortex skill pack lives in console-api. Until the CLI moves under
    // apps/ssa-cli, walk up to the shared path.
    const skillsDir = resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "../../../apps/console-api/src/agent/ssa/skills",
    );
    const registry = new CortexRegistry(skillsDir);
    registry.discover();
    wiring = { pool: ownedPool, redis: ownedRedis, registry };
  }

  const adapters: Adapters =
    deps?.adapters ??
    (await buildRealAdapters({
      logger,
      ring,
      pool: wiring!.pool,
      redis: wiring!.redis,
      registry: wiring!.registry,
    }));
  const nano = deps?.nano ?? makeFixtureAwareNano();

  const app = render(
    React.createElement(App, {
      adapters,
      interpret: (input, turns) =>
        interpret(
          {
            input,
            recentTurns: turns as never,
            availableEntityIds: [],
          },
          nano,
        ),
      etaEstimate: (k, s) => eta.estimate(k, s),
      etaRecord: (k, s, ms) => eta.record(k, s, ms),
    }),
  );

  // In prod, when we own the pool/redis, make sure they close on exit.
  if (ownedPool || ownedRedis) {
    app.waitUntilExit().finally(() => {
      ownedPool?.end().catch((): void => undefined);
      ownedRedis?.quit().catch((): void => undefined);
    });
  }
}

export interface RealAdapterDeps {
  logger: pino.Logger;
  ring: PinoRingBuffer;
  pool: Pool;
  redis: IORedis;
  registry: CortexRegistry;
}

/**
 * Wire real thalamus + sweep services against a live Postgres + Redis pair.
 *
 * 1. thalamus.runCycle   — ThalamusService.runCycle + graphService.listFindings
 * 2. telemetry.start     — startTelemetrySwarm (UC_TELEMETRY swarm launch)
 * 3. logs.tail           — pino ring buffer (unchanged)
 * 4. graph.neighbourhood — inline SQL over research_edge
 * 5. resolution.accept   — SweepResolutionService.resolve (accept then resolve)
 * 6. why.build           — compose from research_finding + research_edge + source_item
 */
export async function buildRealAdapters(
  ctx: RealAdapterDeps,
): Promise<Adapters> {
  const db: Database = drizzle(ctx.pool);

  // Thalamus DI — full container against the live DB.
  // CLI doesn't run cycles in-process (it routes via console-api HTTP),
  // so domainConfig defaults to noopDomainConfig inside the kernel.
  const skillsDir = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "../../../apps/console-api/src/agent/ssa/skills",
  );
  const thalamusC = buildThalamusContainer({
    db,
    skillsDir,
    dataProvider: {},
  });

  // Sweep DI — for resolution + telemetry-swarm launch.
  const llmMode =
    (process.env.THALAMUS_MODE as "cloud" | "fixtures" | "record") ??
    "fixtures";
  const sweepC = buildSweepContainer({
    db,
    redis: ctx.redis,
    graphService: thalamusC.graphService,
    sim: {
      cortexRegistry: ctx.registry,
      embed: async () => null, // deterministic fallback — no Voyage dep required
      llmMode,
    },
  });

  return {
    // --- 1. thalamus.runCycle -------------------------------------------
    thalamus: {
      runCycle: async ({ query, cycleId }) => {
        const cycle = await thalamusC.thalamusService.runCycle({
          query,
          triggerType: ResearchCycleTrigger.User,
          triggerSource: `cli:${cycleId}`,
          lang: "en",
          mode: "audit",
          minConfidence: 0.5,
        });
        const findings = await thalamusC.graphService.listFindings({
          limit: 5,
          minConfidence: 0.5,
        });
        const scoped = findings.filter(
          (f) => String(f.researchCycleId) === String(cycle.id),
        );
        return {
          findings: (scoped.length > 0 ? scoped : findings).map((f) => ({
            id: String(f.id),
            summary: f.summary,
            title: f.title,
            sourceClass: "KG",
            confidence: f.confidence,
            evidenceRefs: [] as string[],
          })),
          costUsd: cycle.totalCost ?? 0,
        };
      },
    },

    // --- 2. telemetry.start ---------------------------------------------
    telemetry: {
      start: async ({ satId: _satId }) => {
        // Plan 2 · B.10: startTelemetrySwarm relocated to console-api SSA
        // pack. CLI is slated to migrate to HTTP in Plan 3
        // (POST /api/sim/telemetry/start). Until that lands, this path
        // throws at runtime instead of compiling to a broken import.
        throw new Error(
          "CLI telemetry.start is disabled until Plan 3 (CLI → HTTP). " +
            "Use the console-api HTTP route or the SSA pack launcher directly.",
        );
      },
    },

    // --- 3. logs.tail ---------------------------------------------------
    logs: new LogsAdapter(ctx.ring),

    // --- 4. graph.neighbourhood (research_edge lookup) ------------------
    graph: {
      neighbourhood: async (entity: string) => {
        // entity format: `${entityType}:${entityId}` (fallback: satellite:N).
        const [etype, eidRaw] = entity.includes(":")
          ? entity.split(":", 2)
          : ["satellite", entity];
        const eid = Number(eidRaw);
        if (!Number.isFinite(eid)) {
          return { root: entity, levels: [{ depth: 0, nodes: [entity] }] };
        }
        const rows = await db
          .select({
            findingId: researchEdge.findingId,
            relation: researchEdge.relation,
          })
          .from(researchEdge)
          .where(
            sql`${researchEdge.entityType} = ${etype} AND ${researchEdge.entityId} = ${BigInt(eid)}`,
          )
          .limit(50);
        const nodes = rows.map((r) => `finding:${r.findingId}(${r.relation})`);
        return {
          root: entity,
          levels: [
            { depth: 0, nodes: [entity] },
            ...(nodes.length > 0 ? [{ depth: 1, nodes }] : []),
          ],
        };
      },
    },

    // --- 5. resolution.accept -------------------------------------------
    resolution: {
      accept: async (suggestionId: string) => {
        // Real SweepResolutionService.resolve short-circuits unless the
        // suggestion is marked accepted=true. Flip the flag via the repo,
        // then dispatch the resolution handlers.
        await sweepC.sweepRepo.review(suggestionId, true, "cli:local");
        const result = await sweepC.resolutionService.resolve(suggestionId);
        return {
          ok: result.status === "success" || result.status === "partial",
          delta: {
            status: result.status,
            affectedRows: result.affectedRows,
            errors: result.errors,
          },
        };
      },
    },

    // --- 6. why.build ---------------------------------------------------
    why: {
      build: async (findingId: string) => {
        return buildWhyTreeFromDb(db, findingId);
      },
    },

    // --- 7. pcEstimator.estimate ---------------------------------------
    // Stubbed at boot level — real wiring lives behind startPcEstimatorSwarm.
    // The web demo uses the fixture-backed adapter in apps/console-api/repl.ts.
    pcEstimator: {
      estimate: async (conjunctionId: string) => {
        return {
          conjunctionId,
          medianPc: 0,
          sigmaPc: 0,
          p5Pc: 0,
          p95Pc: 0,
          fishCount: 0,
          clusters: [],
          samples: [],
          severity: "info" as const,
          methodology: "swarm-pc-estimator",
          note: "pcEstimator boot-level stub — wire startPcEstimatorSwarm for live runs",
        };
      },
    },

    // --- 8. candidates.propose — KNN conjunction candidate proposer ----
    // Routed through the console-api 5-layer (GET /api/conjunctions/knn-candidates).
    // The CLI is an agent — it consumes the same HTTP route as the frontend.
    candidates: {
      propose: async ({ targetNoradId, objectClass, limit }) => {
        const base = process.env.CONSOLE_API_URL ?? "http://localhost:4000";
        const url = new URL(`${base}/api/conjunctions/knn-candidates`);
        url.searchParams.set("targetNoradId", String(targetNoradId));
        url.searchParams.set("knnK", "300");
        url.searchParams.set("limit", String(limit ?? 25));
        url.searchParams.set("marginKm", "20");
        url.searchParams.set("excludeSameFamily", "true");
        if (objectClass) url.searchParams.set("objectClass", objectClass);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`knn-candidates ${res.status}`);
        return (await res.json()) as Array<Record<string, unknown>>;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Why-tree composer — research_finding + research_edge + source_item
// ---------------------------------------------------------------------------

interface WhyNode {
  id: string;
  label: string;
  kind: "finding" | "edge" | "source_item";
  sha256?: string;
  children: WhyNode[];
}

async function buildWhyTreeFromDb(
  db: Database,
  findingId: string,
): Promise<WhyNode | null> {
  // Accept either "finding:N" or "N".
  const raw = findingId.startsWith("finding:")
    ? findingId.slice("finding:".length)
    : findingId;
  let fid: bigint;
  try {
    fid = BigInt(raw);
  } catch {
    return null;
  }
  const f = await db
    .select({
      id: researchFinding.id,
      title: researchFinding.title,
      cycleId: researchFinding.researchCycleId,
    })
    .from(researchFinding)
    .where(eq(researchFinding.id, fid))
    .limit(1)
    .then((rows) => rows[0]);
  if (!f) return null;

  const edges = await db
    .select({
      id: researchEdge.id,
      relation: researchEdge.relation,
      entityType: researchEdge.entityType,
      entityId: researchEdge.entityId,
    })
    .from(researchEdge)
    .where(eq(researchEdge.findingId, fid));

  const children: WhyNode[] = edges.map((e): WhyNode => ({
    id: `edge:${e.id}`,
    label: `${e.relation} → ${e.entityType}:${e.entityId}`,
    kind: "edge",
    children: [],
  }));

  // Best-effort: attach a source_item if the cycle's trigger_source carries one.
  const cycle = await db
    .select({
      id: researchCycle.id,
      triggerSource: researchCycle.triggerSource,
    })
    .from(researchCycle)
    .where(eq(researchCycle.id, f.cycleId))
    .limit(1)
    .then((rows) => rows[0]);
  if (cycle?.triggerSource) {
    const idMatch = /source_item:(\d+)/.exec(cycle.triggerSource);
    if (idMatch) {
      const si = await db
        .select({ id: sourceItem.id, url: sourceItem.url, title: sourceItem.title })
        .from(sourceItem)
        .where(eq(sourceItem.id, BigInt(idMatch[1])))
        .limit(1)
        .then((rows) => rows[0]);
      if (si) {
        children.push({
          id: `source_item:${si.id}`,
          label: si.url ?? si.title,
          kind: "source_item",
          children: [],
        });
      }
    }
  }

  return {
    id: `finding:${f.id}`,
    label: f.title,
    kind: "finding",
    children,
  };
}

// ---------------------------------------------------------------------------
// Nano caller — interprets free-form text into a RouterPlan via skill prompt
// ---------------------------------------------------------------------------

/**
 * Mode-aware nano caller: honours THALAMUS_MODE=fixtures|record|cloud via
 * `callNanoWithMode`. `system` + `user` are forwarded as (instructions,
 * input). When fixtures are missing (or OPENAI_API_KEY unset in cloud mode),
 * returns a minimal valid RouterPlan so the REPL stays interactive — the
 * explicit `/verb` parser covers the happy path regardless.
 */
export function makeFixtureAwareNano(): BootDeps["nano"] {
  return {
    call: async ({ system, user }) => {
      try {
        const res = await callNanoWithMode({
          instructions: system,
          input: user,
          enableWebSearch: false,
        });
        if (!res.ok) {
          return {
            content: JSON.stringify({ steps: [], confidence: 0 }),
            costUsd: 0,
          };
        }
        return { content: res.text, costUsd: 0 };
      } catch {
        return {
          content: JSON.stringify({ steps: [], confidence: 0 }),
          costUsd: 0,
        };
      }
    },
  };
}

/**
 * Hard-failing stub — kept for contexts where no transport is available.
 */
export function makeStubNano(): BootDeps["nano"] {
  return {
    call: async () => {
      throw new Error("nano caller not wired — CLI in stub mode");
    },
  };
}

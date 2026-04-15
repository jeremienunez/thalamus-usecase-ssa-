/**
 * console-api — thin Fastify layer over the live Postgres + Redis stack.
 *
 * Every endpoint is backed by real data: satellites come from the `satellite`
 * table (joined to operator / country / regime), conjunctions from
 * `conjunction_event`, findings from `research_finding`. The `/api/cycles/run`
 * button launches an actual Thalamus research cycle (and/or a Sweep data-
 * quality pass) that writes to the DB. No fixture paths — we show the
 * architecture running for real.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import * as schema from "@interview/db-schema";
import { buildThalamusContainer } from "@interview/thalamus";
import { buildSweepContainer } from "@interview/sweep";
import { runTurn } from "./repl";

// Enum value copied by hand (not imported) — Node 24's strip-types doesn't
// carry TS `enum` through an ESM workspace, and wrapping in a proper runtime
// const is safer than hoping the loader chain cooperates.
// Source of truth: packages/shared/src/enum/research.enum.ts → ResearchCycleTrigger.User = "user"
const TRIGGER_USER = "user" as const;

// ───────────────────────────────────────────────────────── boot
const app = Fastify({ logger: { level: "info" } });

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema }) as unknown as NodePgDatabase<typeof schema>;
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

const thalamus = buildThalamusContainer({ db });
const sweep = buildSweepContainer({ db, redis });

app.log.info(
  {
    databaseUrl: databaseUrl.replace(/:\/\/[^@]+@/, "://***@"),
    redisUrl,
    cortices: thalamus.registry.size(),
  },
  "backend containers booted",
);

// ───────────────────────────────────────────────────────── DTO shapes
type Regime = "LEO" | "MEO" | "GEO" | "HEO";

function normaliseRegime(raw: string | null | undefined): Regime {
  if (!raw) return "LEO";
  const r = raw.toLowerCase();
  if (r.includes("geo")) return "GEO";
  if (r.includes("meo")) return "MEO";
  if (r.includes("heo") || r.includes("hi")) return "HEO";
  return "LEO";
}

function regimeFromMeanMotion(mm: number | null | undefined): Regime {
  if (mm == null) return "LEO";
  if (mm < 1.1) return "GEO";
  if (mm < 5) return "MEO";
  if (mm < 11) return "HEO";
  return "LEO";
}

function smaFromMeanMotion(mm: number): number {
  // Kepler: a = ∛( μ · (T/2π)² ), T in seconds, μ = 398600.4418 km³/s²
  const period = 86400 / mm;
  return Math.pow(398600.4418 * Math.pow(period / (2 * Math.PI), 2), 1 / 3);
}

function classificationTier(
  raw: string | null,
): "unclassified" | "sensitive" | "restricted" {
  if (!raw) return "unclassified";
  const r = raw.toLowerCase();
  if (r.includes("restrict") || r.includes("classif")) return "restricted";
  if (r.includes("sensit") || r.includes("limit")) return "sensitive";
  return "unclassified";
}

// ───────────────────────────────────────────────────────── endpoints
app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

app.get<{ Querystring: { regime?: string; limit?: string } }>(
  "/api/satellites",
  async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 2000), 5000);
    const rows = await db.execute<{
      id: string;
      name: string;
      norad_id: number | null;
      operator: string | null;
      operator_country: string | null;
      launch_year: number | null;
      mass_kg: number | null;
      classification_tier: string | null;
      opacity_score: string | null;
      telemetry_summary: Record<string, unknown> | null;
    }>(sql`
      SELECT
        s.id::text                                       AS id,
        s.name,
        NULLIF(s.telemetry_summary->>'noradId','')::int  AS norad_id,
        op.name                                          AS operator,
        oc.name                                          AS operator_country,
        s.launch_year,
        s.mass_kg,
        s.classification_tier,
        s.opacity_score::text,
        s.telemetry_summary
      FROM satellite s
      LEFT JOIN operator op          ON op.id = s.operator_id
      LEFT JOIN operator_country oc  ON oc.id = s.operator_country_id
      WHERE s.telemetry_summary ? 'raan'
      ORDER BY s.id
      LIMIT ${limit}
    `);

    const items = rows.rows.map((r) => {
      const ts = r.telemetry_summary ?? {};
      const mm = Number(ts.meanMotion ?? 15);
      const inc = Number(ts.inclination ?? 0);
      const ecc = Number(ts.eccentricity ?? 0);
      const regime =
        typeof ts.regime === "string"
          ? normaliseRegime(String(ts.regime))
          : regimeFromMeanMotion(mm);
      const opacityScore = r.opacity_score ? Number(r.opacity_score) : null;
      return {
        id: Number(r.id),
        name: r.name,
        noradId: r.norad_id ?? 0,
        regime,
        operator: r.operator ?? "Unknown",
        country: r.operator_country ?? "—",
        inclinationDeg: inc,
        semiMajorAxisKm: smaFromMeanMotion(mm),
        eccentricity: ecc,
        raanDeg: Number(ts.raan ?? 0),
        argPerigeeDeg: Number(ts.argPerigee ?? 0),
        meanAnomalyDeg: Number(ts.meanAnomaly ?? 0),
        meanMotionRevPerDay: mm,
        epoch:
          typeof ts.epoch === "string"
            ? ts.epoch
            : new Date().toISOString(),
        massKg: r.mass_kg ?? 0,
        classificationTier: classificationTier(r.classification_tier),
        opacityScore,
      };
    });

    const filtered = req.query.regime
      ? items.filter((s) => s.regime === req.query.regime)
      : items;
    return { items: filtered, total: filtered.length };
  },
);

app.get<{ Querystring: { minPc?: string } }>(
  "/api/conjunctions",
  async (req) => {
    const minPc = Number(req.query.minPc ?? 0);
    const rows = await db.execute<{
      id: string;
      primary_id: string;
      secondary_id: string;
      primary_name: string;
      secondary_name: string;
      primary_mm: number | null;
      epoch: Date | string;
      min_range_km: number;
      relative_velocity_kmps: number | null;
      probability_of_collision: number | null;
      combined_sigma_km: number | null;
      hard_body_radius_m: number | null;
      pc_method: string | null;
      computed_at: Date | string;
    }>(sql`
      SELECT
        ce.id::text                                         AS id,
        ce.primary_satellite_id::text                       AS primary_id,
        ce.secondary_satellite_id::text                     AS secondary_id,
        sp.name                                             AS primary_name,
        ss.name                                             AS secondary_name,
        NULLIF(sp.telemetry_summary->>'meanMotion','')::float AS primary_mm,
        ce.epoch,
        ce.min_range_km,
        ce.relative_velocity_kmps,
        ce.probability_of_collision,
        ce.combined_sigma_km,
        ce.hard_body_radius_m,
        ce.pc_method,
        ce.computed_at
      FROM conjunction_event ce
      LEFT JOIN satellite sp ON sp.id = ce.primary_satellite_id
      LEFT JOIN satellite ss ON ss.id = ce.secondary_satellite_id
      WHERE COALESCE(ce.probability_of_collision, 0) >= ${minPc}
      ORDER BY ce.probability_of_collision DESC NULLS LAST
      LIMIT 500
    `);

    const toIso = (v: Date | string): string =>
      v instanceof Date ? v.toISOString() : new Date(v).toISOString();

    const items = rows.rows.map((r) => {
      const pc = r.probability_of_collision ?? 0;
      const sigma = r.combined_sigma_km ?? 10;
      const regime = regimeFromMeanMotion(r.primary_mm);
      const covarianceQuality =
        sigma < 0.1 ? "HIGH" : sigma < 1 ? "MED" : "LOW";
      const action =
        pc >= 1e-4
          ? "maneuver_candidate"
          : pc >= 1e-6
            ? "monitor"
            : "no_action";
      return {
        id: Number(r.id),
        primaryId: Number(r.primary_id),
        secondaryId: Number(r.secondary_id),
        primaryName: r.primary_name ?? `sat-${r.primary_id}`,
        secondaryName: r.secondary_name ?? `sat-${r.secondary_id}`,
        regime,
        epoch: toIso(r.epoch),
        minRangeKm: r.min_range_km,
        relativeVelocityKmps: r.relative_velocity_kmps ?? 0,
        probabilityOfCollision: pc,
        combinedSigmaKm: sigma,
        hardBodyRadiusM: r.hard_body_radius_m ?? 20,
        pcMethod: r.pc_method ?? "foster-gaussian",
        computedAt: toIso(r.computed_at),
        covarianceQuality,
        action,
      };
    });
    return { items, total: items.length };
  },
);

app.get("/api/kg/nodes", async () => {
  // Build KG nodes from real DB: satellites (top 120 by name), operators, regimes, findings.
  const [sats, ops, regimes, findings] = await Promise.all([
    db.execute<{ id: string; name: string }>(sql`
      SELECT id::text, name FROM satellite ORDER BY name LIMIT 120
    `),
    db.execute<{ id: string; name: string }>(sql`
      SELECT id::text, name FROM operator ORDER BY name
    `),
    db.execute<{ id: string; name: string }>(sql`
      SELECT id::text, name FROM orbit_regime ORDER BY name
    `),
    db.execute<{ id: string; title: string; cortex: string }>(sql`
      SELECT id::text, title, cortex FROM research_finding
      ORDER BY created_at DESC LIMIT 80
    `),
  ]);

  const items = [
    ...regimes.rows.map((r) => ({
      id: `regime:${r.name}`,
      label: r.name,
      class: "OrbitRegime" as const,
      degree: 0,
      x: 0,
      y: 0,
      cortex: "—",
    })),
    ...ops.rows.map((o) => ({
      id: `op:${o.name}`,
      label: o.name,
      class: "Operator" as const,
      degree: 0,
      x: 0,
      y: 0,
      cortex: "—",
    })),
    ...sats.rows.map((s) => ({
      id: `sat:${s.id}`,
      label: s.name,
      class: "Satellite" as const,
      degree: 0,
      x: 0,
      y: 0,
      cortex: "catalog",
    })),
    ...findings.rows.map((f) => ({
      id: `finding:${f.id}`,
      label: f.title.slice(0, 32),
      class: "Payload" as const, // reuse existing EntityClass bucket for findings
      degree: 0,
      x: 0,
      y: 0,
      cortex: f.cortex,
    })),
  ];
  return { items };
});

app.get("/api/kg/edges", async () => {
  const rows = await db.execute<{
    id: string;
    finding_id: string;
    entity_type: string;
    entity_id: string;
    relation: string;
  }>(sql`
    SELECT id::text, finding_id::text, entity_type, entity_id::text, relation
    FROM research_edge ORDER BY id DESC LIMIT 400
  `);
  const items = rows.rows.map((e) => ({
    id: e.id,
    source: `finding:${e.finding_id}`,
    target:
      e.entity_type === "satellite"
        ? `sat:${e.entity_id}`
        : e.entity_type === "operator"
          ? `op:${e.entity_id}`
          : `${e.entity_type}:${e.entity_id}`,
    relation: e.relation,
  }));
  return { items };
});

app.get<{ Querystring: { status?: string; cortex?: string } }>(
  "/api/findings",
  async (req) => {
    const { status, cortex } = req.query;
    const rows = await db.execute<{
      id: string;
      title: string;
      summary: string;
      cortex: string;
      status: string;
      confidence: number;
      created_at: Date;
      research_cycle_id: string;
    }>(sql`
      SELECT
        id::text, title, summary, cortex, status::text, confidence,
        created_at, research_cycle_id::text
      FROM research_finding
      WHERE ${status ? sql`status::text = ${status}` : sql`TRUE`}
        AND ${cortex ? sql`cortex::text = ${cortex}` : sql`TRUE`}
      ORDER BY created_at DESC
      LIMIT 300
    `);

    const items = rows.rows.map((f) => ({
      id: `f:${f.id}`,
      title: f.title,
      summary: f.summary,
      cortex: f.cortex,
      status: mapFindingStatus(f.status),
      priority: Math.round(f.confidence * 100),
      createdAt: f.created_at.toISOString(),
      linkedEntityIds: [] as string[], // filled next
      evidence: [] as Array<{ kind: "osint" | "field" | "derived"; uri: string; snippet: string }>,
    }));

    // Fetch edges in one shot to populate linkedEntityIds
    if (items.length > 0) {
      const ids = items.map((i) => i.id.slice(2));
      const edges = await db.execute<{
        finding_id: string;
        entity_type: string;
        entity_id: string;
      }>(sql`
        SELECT finding_id::text, entity_type, entity_id::text
        FROM research_edge
        WHERE finding_id::text = ANY(${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[]`})
      `);
      const edgeMap = new Map<string, string[]>();
      for (const e of edges.rows) {
        const key = `f:${e.finding_id}`;
        const linked =
          e.entity_type === "satellite"
            ? `sat:${e.entity_id}`
            : e.entity_type === "operator"
              ? `op:${e.entity_id}`
              : `${e.entity_type}:${e.entity_id}`;
        if (!edgeMap.has(key)) edgeMap.set(key, []);
        edgeMap.get(key)!.push(linked);
      }
      for (const f of items) f.linkedEntityIds = edgeMap.get(f.id) ?? [];
    }

    return { items, total: items.length };
  },
);

function mapFindingStatus(
  s: string,
): "pending" | "accepted" | "rejected" | "in-review" {
  const l = s.toLowerCase();
  if (l === "archived") return "accepted";
  if (l === "invalidated") return "rejected";
  if (l === "active") return "pending";
  return "in-review";
}

// ───────────────────────────────────────────────────────── cycle launcher
type CycleKind = "thalamus" | "fish" | "both";
type CycleRun = {
  id: string;
  kind: CycleKind;
  startedAt: string;
  completedAt: string;
  findingsEmitted: number;
  cortices: string[];
  error?: string;
};

const cycleHistory: CycleRun[] = [];

async function runThalamus(query: string): Promise<number> {
  const cycle = await thalamus.thalamusService.runCycle({
    query,
    triggerType: TRIGGER_USER as unknown as never,
    triggerSource: "console-ui",
  });
  return cycle.findingsCount ?? 0;
}

async function runFish(): Promise<number> {
  const result = await sweep.nanoSweepService.sweep(5, "dataQuality");
  return result.suggestionsStored ?? 0;
}

app.post<{ Body: { kind?: CycleKind; query?: string } }>(
  "/api/cycles/run",
  async (req, reply) => {
    const kind = req.body?.kind;
    if (kind !== "thalamus" && kind !== "fish" && kind !== "both") {
      return reply
        .code(400)
        .send({ error: "kind must be 'thalamus' | 'fish' | 'both'" });
    }
    const query =
      req.body?.query?.trim() ||
      "Current SSA situation — upcoming conjunctions, catalog anomalies, debris forecast";
    const startedAt = new Date().toISOString();
    const id = `cyc:${Date.now().toString(36)}`;

    try {
      let emitted = 0;
      const cortices: string[] = [];

      if (kind === "thalamus" || kind === "both") {
        emitted += await runThalamus(query);
        cortices.push("thalamus");
      }
      if (kind === "fish" || kind === "both") {
        emitted += await runFish();
        cortices.push("nano-sweep");
      }

      const run: CycleRun = {
        id,
        kind,
        startedAt,
        completedAt: new Date().toISOString(),
        findingsEmitted: emitted,
        cortices,
      };
      cycleHistory.unshift(run);
      if (cycleHistory.length > 20) cycleHistory.pop();
      return { cycle: run };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      app.log.error({ err: errMsg, kind }, "cycle run failed");
      const run: CycleRun = {
        id,
        kind,
        startedAt,
        completedAt: new Date().toISOString(),
        findingsEmitted: 0,
        cortices: [],
        error: errMsg,
      };
      cycleHistory.unshift(run);
      return reply.code(500).send({ cycle: run, error: errMsg });
    }
  },
);

app.get("/api/cycles", async () => ({ items: cycleHistory }));

// ───────────────────────────────────────────────────────── stats
app.get("/api/stats", async () => {
  const [[stat]] = await Promise.all([
    db
      .execute<{
        satellites: number;
        conjunctions: number;
        findings: number;
        kg_edges: number;
        research_cycles: number;
      }>(sql`
        SELECT
          (SELECT count(*) FROM satellite)            AS satellites,
          (SELECT count(*) FROM conjunction_event)    AS conjunctions,
          (SELECT count(*) FROM research_finding)     AS findings,
          (SELECT count(*) FROM research_edge)        AS kg_edges,
          (SELECT count(*) FROM research_cycle)       AS research_cycles
      `)
      .then((r) => [r.rows[0]!]),
  ]);

  const byStatus = await db.execute<{ status: string; count: number }>(sql`
    SELECT status::text, count(*)::int FROM research_finding GROUP BY status
  `);
  const byCortex = await db.execute<{ cortex: string; count: number }>(sql`
    SELECT cortex::text, count(*)::int FROM research_finding GROUP BY cortex
  `);

  return {
    satellites: Number(stat.satellites),
    conjunctions: Number(stat.conjunctions),
    kgNodes: Number(stat.satellites) + Number(stat.findings),
    kgEdges: Number(stat.kg_edges),
    findings: Number(stat.findings),
    researchCycles: Number(stat.research_cycles),
    byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, Number(r.count)])),
    byCortex: Object.fromEntries(byCortex.rows.map((r) => [r.cortex, Number(r.count)])),
  };
});

// ───────────────────────────────────────────────────────── REPL (unchanged — heuristic router over fixtures)
// Kept for the command palette; natural-language routing will swap to the CLI planner later.
app.post<{ Body: { input: string; sessionId: string } }>(
  "/api/repl/turn",
  async (req, reply) => {
    const { input, sessionId } = req.body ?? ({} as { input: string; sessionId: string });
    if (!input || typeof input !== "string") {
      return reply.code(400).send({ error: "input required" });
    }
    const out = await runTurn(
      input,
      { satellites: [], kgNodes: [], kgEdges: [], findings: [] },
      sessionId ?? "anon",
    );
    return out;
  },
);

async function main(): Promise<void> {
  await app.register(cors, { origin: true });
  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`console-api listening on :${port}`);
}

main().catch((err) => {
  app.log.error({ err: err instanceof Error ? err.message : String(err) }, "boot failed");
  process.exit(1);
});

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
import {
  BAS_NIVEAU_LOGIT_BIAS,
  buildThalamusContainer,
  createLlmTransportWithMode,
  callNanoWithMode,
} from "@interview/thalamus";
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
      created_at: Date | string;
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
      createdAt: (f.created_at instanceof Date ? f.created_at : new Date(f.created_at)).toISOString(),
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

// ───────────────────────────────────────────────────────── Sweep suggestions
app.get("/api/sweep/suggestions", async () => {
  const res = await sweep.sweepRepo.list({ reviewed: false, limit: 100 });
  const items = res.rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    suggestedAction: r.suggestedAction,
    category: r.category,
    severity: r.severity,
    operatorCountryName: r.operatorCountryName,
    affectedSatellites: r.affectedSatellites,
    createdAt: r.createdAt,
    accepted: r.accepted,
    resolutionStatus: r.resolutionStatus,
    hasPayload: Boolean(r.resolutionPayload),
  }));
  return { items, total: items.length };
});

app.post<{ Params: { id: string }; Body: { accept: boolean; reason?: string } }>(
  "/api/sweep/suggestions/:id/review",
  async (req, reply) => {
    const { id } = req.params;
    const { accept, reason } = req.body ?? { accept: false };
    const ok = await sweep.sweepRepo.review(id, accept, reason);
    if (!ok) return reply.code(404).send({ error: "not found" });

    if (accept) {
      const result = await sweep.resolutionService.resolve(id);
      return { ok: true, reviewed: true, resolution: result };
    }
    return { ok: true, reviewed: true, resolution: null };
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

function toDbStatus(s: string): "active" | "archived" | "invalidated" {
  if (s === "accepted") return "archived";
  if (s === "rejected") return "invalidated";
  return "active";
}

function parseFindingId(raw: string): bigint | null {
  const s = raw.startsWith("f:") ? raw.slice(2) : raw;
  if (!/^\d+$/.test(s)) return null;
  try { return BigInt(s); } catch { return null; }
}

app.get<{ Params: { id: string } }>(
  "/api/findings/:id",
  async (req, reply) => {
    const fid = parseFindingId(req.params.id);
    if (fid === null) return reply.code(400).send({ error: "invalid id" });
    const rows = await db.execute<{
      id: string;
      title: string;
      summary: string;
      cortex: string;
      status: string;
      confidence: number;
      evidence: unknown;
      created_at: Date | string;
    }>(sql`
      SELECT id::text, title, summary, cortex, status::text, confidence, evidence, created_at
      FROM research_finding WHERE id = ${fid}
    `);
    const f = rows.rows[0];
    if (!f) return reply.code(404).send({ error: "not found" });

    const edges = await db.execute<{ entity_type: string; entity_id: string }>(sql`
      SELECT entity_type, entity_id::text
      FROM research_edge WHERE finding_id = ${fid}
      LIMIT 20
    `);
    const linkedEntityIds = edges.rows.map((e) =>
      e.entity_type === "satellite" ? `sat:${e.entity_id}`
      : e.entity_type === "operator" ? `op:${e.entity_id}`
      : `${e.entity_type}:${e.entity_id}`,
    );

    const evidence = Array.isArray(f.evidence)
      ? (f.evidence as Array<{ source?: string; data?: { url?: string; uri?: string; snippet?: string } }>).map((e) => {
          const d = e.data ?? {};
          const src = String(e.source ?? "derived").toLowerCase();
          const kind = src === "field" ? "field" as const : src === "osint" ? "osint" as const : "derived" as const;
          return { kind, uri: d.url ?? d.uri ?? "—", snippet: d.snippet ?? "" };
        })
      : [];

    return {
      id: `f:${f.id}`,
      title: f.title,
      summary: f.summary,
      cortex: f.cortex,
      status: mapFindingStatus(f.status),
      priority: Math.round(f.confidence * 100),
      createdAt: (f.created_at instanceof Date ? f.created_at : new Date(f.created_at)).toISOString(),
      linkedEntityIds,
      evidence,
    };
  },
);

app.post<{ Params: { id: string }; Body: { decision: string; reason?: string } }>(
  "/api/findings/:id/decision",
  async (req, reply) => {
    const fid = parseFindingId(req.params.id);
    if (fid === null) return reply.code(400).send({ error: "invalid id" });
    const { decision } = req.body ?? ({} as { decision: string });
    if (!["accepted", "rejected", "pending", "in-review"].includes(decision)) {
      return reply.code(400).send({ error: "invalid decision" });
    }
    const dbStatus = toDbStatus(decision);
    const updated = await db.execute<{ id: string }>(sql`
      UPDATE research_finding
      SET status = ${dbStatus}::finding_status, updated_at = NOW()
      WHERE id = ${fid}
      RETURNING id::text
    `);
    if (updated.rows.length === 0) return reply.code(404).send({ error: "not found" });
    // Re-fetch as DTO
    const res = await app.inject({ method: "GET", url: `/api/findings/${req.params.id}` });
    return { ok: true, finding: res.json() };
  },
);

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

// ───────────────────────────────────────────────────────── autonomy loop
type AutonomyAction = "thalamus" | "sweep-nullscan" | "fish-swarm";
type AutonomyTick = {
  id: string;
  action: AutonomyAction;
  queryOrMode: string;
  startedAt: string;
  completedAt: string;
  emitted: number;
  error?: string;
};

const THALAMUS_QUERIES = [
  "Detect suspicious orbital behaviour — maneuvers, regime breakouts, missing telemetry",
  "Audit conjunction risk across the fleet — top Pc events and their operators",
  "Find catalog anomalies — mass, launch year, platform class gaps worth prioritising",
  "Correlate OSINT advisory feeds with current fleet — any flagged operators",
  "Surface high-opacity objects — low-confidence classifications needing follow-up",
  "Cross-check recent sim-fish suggestions with Thalamus findings — contradictions?",
];

type AutonomyState = {
  running: boolean;
  intervalMs: number;
  tickCount: number;
  currentTick: AutonomyTick | null;
  history: AutonomyTick[];
  startedAt: string | null;
  rotationIdx: number;
  queryIdx: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
};

const autonomy: AutonomyState = {
  running: false,
  intervalMs: 45_000,
  tickCount: 0,
  currentTick: null,
  history: [],
  startedAt: null,
  rotationIdx: 0,
  queryIdx: 0,
  timer: null,
  busy: false,
};

// briefing mode returns 0 operator-countries once gaps are scanned — drop it
// from the rotation and keep the productive thalamus ↔ nullScan cadence.
const ROTATION: AutonomyAction[] = ["thalamus", "sweep-nullscan"];

async function autonomyTick(): Promise<void> {
  if (autonomy.busy || !autonomy.running) return;
  autonomy.busy = true;
  const action = ROTATION[autonomy.rotationIdx % ROTATION.length]!;
  autonomy.rotationIdx++;
  const id = `a:${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let queryOrMode = "";
  let emitted = 0;
  let error: string | undefined;

  try {
    if (action === "thalamus") {
      const q = THALAMUS_QUERIES[autonomy.queryIdx % THALAMUS_QUERIES.length]!;
      autonomy.queryIdx++;
      queryOrMode = q;
      const t: AutonomyTick = { id, action, queryOrMode, startedAt, completedAt: "", emitted: 0 };
      autonomy.currentTick = t;
      emitted = await runThalamus(q);
    } else if (action === "sweep-nullscan") {
      queryOrMode = "nullScan(20 operator-countries)";
      autonomy.currentTick = { id, action, queryOrMode, startedAt, completedAt: "", emitted: 0 };
      emitted = await runFish();
    } else {
      // fish-swarm: briefing sweep (LLM-backed) — complements nullScan
      queryOrMode = "briefing(5 operator-countries)";
      autonomy.currentTick = { id, action, queryOrMode, startedAt, completedAt: "", emitted: 0 };
      const r = await sweep.nanoSweepService.sweep(5, "briefing");
      emitted = r.suggestionsStored ?? 0;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    app.log.error({ err: error, action }, "autonomy tick failed");
  }

  const tick: AutonomyTick = {
    id,
    action,
    queryOrMode,
    startedAt,
    completedAt: new Date().toISOString(),
    emitted,
    ...(error && { error }),
  };
  autonomy.history.unshift(tick);
  if (autonomy.history.length > 40) autonomy.history.pop();
  autonomy.currentTick = null;
  autonomy.tickCount++;
  autonomy.busy = false;
}

app.post<{ Body: { intervalSec?: number } }>("/api/autonomy/start", async (req) => {
  if (autonomy.running) return { ok: true, alreadyRunning: true, state: publicAutonomyState() };
  const sec = Math.max(15, Math.min(600, Number(req.body?.intervalSec ?? 45)));
  autonomy.intervalMs = sec * 1000;
  autonomy.running = true;
  autonomy.startedAt = new Date().toISOString();
  autonomy.timer = setInterval(() => { void autonomyTick(); }, autonomy.intervalMs);
  // fire one immediately so the user sees activity
  void autonomyTick();
  return { ok: true, state: publicAutonomyState() };
});

app.post("/api/autonomy/stop", async () => {
  if (autonomy.timer) clearInterval(autonomy.timer);
  autonomy.timer = null;
  autonomy.running = false;
  return { ok: true, state: publicAutonomyState() };
});

app.get("/api/autonomy/status", async () => publicAutonomyState());

// ───────────────────────────────────────────────────────── sweep mission
// "Give Sweep a mission": for every pending nullScan suggestion, launch a
// web-search LLM fish that tries to find a real value from public sources
// (operator datasheets, CelesTrak, NASA, Gunter's Space Page, …), writes it
// into the suggestion's resolutionPayload, so accepting it actually applies
// the backfill — instead of just acknowledging the gap.

type MissionTask = {
  suggestionId: string;
  satelliteId: string;
  satelliteName: string;
  noradId: number | null;
  field: string;
  operatorCountry: string;
  status: "pending" | "researching" | "filled" | "unobtainable" | "error";
  value: string | number | null;
  confidence: number;
  source: string | null;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

type MissionState = {
  running: boolean;
  startedAt: string | null;
  tasks: MissionTask[];
  completedCount: number;
  filledCount: number;
  unobtainableCount: number;
  errorCount: number;
  cursor: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
};

const mission: MissionState = {
  running: false,
  startedAt: null,
  tasks: [],
  completedCount: 0,
  filledCount: 0,
  unobtainableCount: 0,
  errorCount: 0,
  cursor: 0,
  timer: null,
  busy: false,
};

const MISSION_SYSTEM_PROMPT = `You are an SSA catalog researcher using gpt-5.4-nano with web search.
You receive ONE specific satellite (by name and NORAD id) and ONE field to fill.
Find the authoritative value for THAT satellite on a public page.

Return STRICT JSON only:
{"value": <number|string|null>, "unit": "<unit or empty>", "confidence": <0.0–1.0>, "source": "<canonical URL>"}

HARD RULES:
1. "source" MUST be a full https:// URL of the page carrying the value (Wikipedia,
   n2yo.com, gunter's space page, eoPortal, NASA/ESA mission page, operator press kit).
2. "value" MUST be the EXACT figure from that page.
3. NEVER hedge with: typical, approximately, about, around, roughly, estimated,
   various, usually, generally, commonly, unknown, not specified, not available,
   variable, depends, ranges from.
4. If the page gives a range, take the median and cap confidence ≤ 0.7.
5. If no page states the value for this specific satellite, return
   {"value": null, "confidence": 0, "source": "<what you searched>"}.
6. Never invent URLs. If you did not actually open the page, confidence = 0.`;

const MISSION_RESPONSE_FORMAT = {
  type: "json_schema",
  name: "sweep_fill",
  strict: true,
  schema: {
    type: "object",
    properties: {
      value: { type: ["number", "string", "null"] },
      unit: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      source: { type: "string", pattern: "^https://[^\\s]+$|^$" },
    },
    required: ["value", "unit", "confidence", "source"],
    additionalProperties: false,
  },
} as const;

// Fabrication/hedging tokens — presence in the response body means the LLM is
// guessing. Hard-rejected regardless of self-reported confidence.
const FABRICATION_TOKENS = [
  /\btypical(ly)?\b/i,
  /\bapprox(imately)?\b/i,
  /\babout\b/i,
  /\baround\b/i,
  /\broughly\b/i,
  /\bestimate[ds]?\b/i,
  /\bvarious\b/i,
  /\busually\b/i,
  /\bgeneral(ly)?\b/i,
  /\bcommon(ly)?\b/i,
  /\bmost\s+of\b/i,
  /\bN\/A\b/i,
  /\bunknown\b/i,
  /\bnot\s+specified\b/i,
  /\bnot\s+available\b/i,
  /\bvariable\b/i,
  /\bdepends?\b/i,
  /\branges?\s+from\b/i,
  /\bvaries\b/i,
];

function detectFabrication(text: string): string | null {
  for (const re of FABRICATION_TOKENS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

// Flat shape rather than a discriminated union — tsconfig.base has
// strictNullChecks off, which disables narrowing. Caller checks `ok`.
type NanoResult = {
  ok: boolean;
  value: string | number | null;
  confidence: number;
  source: string;
  unit: string;
  reason: string;
};

const failed = (reason: string): NanoResult => ({
  ok: false,
  value: null,
  confidence: 0,
  source: "",
  unit: "",
  reason,
});

async function singleNanoVote(task: MissionTask, angle: string): Promise<NanoResult> {
  const noradPart = task.noradId ? ` (NORAD ${task.noradId})` : "";
  const userPrompt = `Satellite: ${task.satelliteName}${noradPart}, operated by ${task.operatorCountry}.
Field to fill: "${task.field}".
${angle}
Find the exact documented value for THIS specific satellite. JSON only. Cite the URL you opened.`;

  const nano = await callNanoWithMode({
    instructions: MISSION_SYSTEM_PROMPT,
    input: userPrompt,
    enableWebSearch: true,
    responseFormat: MISSION_RESPONSE_FORMAT,
    logitBias: BAS_NIVEAU_LOGIT_BIAS,
  });
  if (!nano.ok) return failed(nano.error ?? "nano call failed");

  const hedge = detectFabrication(nano.text);
  if (hedge) return failed(`hedging "${hedge}"`);

  const match = nano.text.match(/\{[\s\S]*\}/);
  if (!match) return failed("no JSON");
  let parsed: { value: string | number | null; unit?: string; confidence: number; source?: string };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return failed("invalid JSON");
  }

  const source = (parsed.source ?? "").trim();
  if (parsed.value === null) return failed("no value");
  if (parsed.confidence < 0.6) return failed(`low confidence ${parsed.confidence}`);
  if (!/^https:\/\/[^\s]+$/.test(source)) return failed("no https source");
  if (!nano.urls.some((u) => u.includes(new URL(source).host))) return failed("source not cited");
  if (unitMismatch(task.field, parsed.unit ?? "")) return failed(`unit "${parsed.unit}"`);

  return {
    ok: true,
    value: parsed.value,
    confidence: parsed.confidence,
    source,
    unit: parsed.unit ?? "",
    reason: "",
  };
}

function voteSummary(v: NanoResult): string {
  if (v.ok) return "ok";
  return v.reason;
}

// Two votes agree iff:
//   - numeric: |a-b| / max(|a|,|b|) ≤ 10%
//   - text:    case-insensitive identical after whitespace normalise
function votesAgree(a: string | number, b: string | number): boolean {
  if (typeof a === "number" && typeof b === "number") {
    const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
    return Math.abs(a - b) / denom <= 0.1;
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

async function runMissionTask(task: MissionTask): Promise<void> {
  task.status = "researching";
  task.startedAt = new Date().toISOString();
  try {
    // 2-vote corroboration: fire two independent queries with different
    // framings, accept iff they agree within tolerance. Single-vote fills are
    // too easy to hallucinate at nano scale.
    const vote1 = await singleNanoVote(task, "Check the operator's official documentation first.");
    const vote2 = await singleNanoVote(task, "Check Wikipedia / eoPortal / Gunter's Space Page first.");

    if (!vote1.ok || !vote2.ok) {
      task.status = "unobtainable";
      task.value = null;
      task.confidence = 0;
      task.source = vote1.ok ? vote1.source : vote2.ok ? vote2.source : null;
      task.error = `vote1=${voteSummary(vote1)}; vote2=${voteSummary(vote2)}`;
      task.completedAt = new Date().toISOString();
      return;
    }

    // Both votes ok → value is non-null by singleNanoVote's invariants.
    const v1 = vote1.value as string | number;
    const v2 = vote2.value as string | number;
    if (!votesAgree(v1, v2)) {
      task.status = "unobtainable";
      task.value = null;
      task.confidence = 0;
      task.source = vote1.source;
      task.error = `votes disagree: ${v1} vs ${v2}`;
      task.completedAt = new Date().toISOString();
      return;
    }

    // Consensus — take vote1's value, confidence boosted by agreement.
    task.status = "filled";
    task.value = v1;
    task.confidence = Math.min(0.95, (vote1.confidence + vote2.confidence) / 2 + 0.15);
    task.source = vote1.source;
    await applySatelliteFieldUpdate(task.satelliteId, task.field, v1, task.source);
  } catch (err) {
    task.status = "error";
    task.error = err instanceof Error ? err.message : String(err);
  }
  task.completedAt = new Date().toISOString();
}

// Whitelist of columns the mission is allowed to write. Excludes FK columns
// (platform_class_id etc.) — those need name→id resolution, handled elsewhere.
const MISSION_WRITABLE_COLUMNS: Record<string, "numeric" | "text"> = {
  lifetime: "numeric",
  power: "numeric",
  variant: "text",
  mass_kg: "numeric",
  launch_year: "numeric",
};

// Per-column sanity bounds. Any filled value outside → unobtainable (silent
// reject, no DB write). Prevents the nano from dumping `launch_year=1850` or
// `mass_kg=-5` into the catalog when its source page was misparsed.
const FIELD_RANGE: Record<string, { min: number; max: number }> = {
  lifetime: { min: 0.1, max: 50 },       // design life in years
  power: { min: 0.1, max: 30_000 },      // payload power in W
  mass_kg: { min: 0.1, max: 30_000 },    // dry mass in kg
  launch_year: { min: 1957, max: 2035 }, // Sputnik → near future
};

function inRange(field: string, value: number): boolean {
  const r = FIELD_RANGE[field];
  if (!r) return true;
  return value >= r.min && value <= r.max;
}

// Unit strings that indicate the value is NOT in the target unit. lifetime is
// years; any mention of days/hours/months → reject (can't auto-convert
// because "months" could be operational or design, ambiguous).
const UNIT_MISMATCHES: Record<string, RegExp> = {
  lifetime: /\b(hour|day|month|minute|second|week)s?\b/i,
  launch_year: /\b(BC|month|day)\b/i,
};

function unitMismatch(field: string, unit: string): boolean {
  const re = UNIT_MISMATCHES[field];
  return re ? re.test(unit) : false;
}

async function applySatelliteFieldUpdate(
  satelliteId: string,
  field: string,
  value: string | number,
  source: string,
): Promise<void> {
  const kind = MISSION_WRITABLE_COLUMNS[field];
  if (!kind) return;
  const coerced =
    kind === "numeric"
      ? typeof value === "number"
        ? value
        : Number.parseFloat(String(value).replace(/[^\d.+-]/g, ""))
      : String(value);
  if (kind === "numeric" && !Number.isFinite(coerced as number)) return;
  if (kind === "numeric" && !inRange(field, coerced as number)) return;

  // Field names are whitelisted above → safe to pass via sql.identifier. Value
  // is bound, never interpolated.
  const satBigInt = BigInt(satelliteId);
  if (field === "variant") {
    await db.execute(sql`UPDATE satellite SET variant = ${coerced} WHERE id = ${satBigInt}`);
  } else if (field === "lifetime") {
    await db.execute(sql`UPDATE satellite SET lifetime = ${coerced} WHERE id = ${satBigInt}`);
  } else if (field === "power") {
    await db.execute(sql`UPDATE satellite SET power = ${coerced} WHERE id = ${satBigInt}`);
  } else if (field === "mass_kg") {
    await db.execute(sql`UPDATE satellite SET mass_kg = ${coerced} WHERE id = ${satBigInt}`);
  } else if (field === "launch_year") {
    await db.execute(sql`UPDATE satellite SET launch_year = ${coerced} WHERE id = ${satBigInt}`);
  }

  // Audit trail — durable record of what was written, where from.
  const missionPayloadJson = JSON.stringify({ field, value: coerced, source });
  await db.execute(sql`
    INSERT INTO sweep_audit (
      suggestion_id, operator_country_name, category, severity,
      title, description, suggested_action, affected_satellites,
      web_evidence, accepted, resolution_status, resolution_payload, reviewed_at
    ) VALUES (
      ${`mission:${satelliteId}:${field}`},
      ${"mission-fill"},
      ${"enrichment"}::sweep_category,
      ${"info"}::sweep_severity,
      ${`Fill ${field}=${coerced} on satellite ${satelliteId}`},
      ${""},
      ${`UPDATE satellite SET ${field}=${coerced}`},
      ${1},
      ${source},
      ${true},
      ${"success"}::sweep_resolution_status,
      ${missionPayloadJson}::jsonb,
      NOW()
    )
  `);

  // Emit a research_finding so Thalamus cortices can reason on this fill.
  await emitEnrichmentFinding({
    kind: "mission",
    satelliteId,
    field,
    value: coerced,
    confidence: 0.9,
    source,
  });
}

async function missionTick(): Promise<void> {
  if (mission.busy || !mission.running) return;
  if (mission.cursor >= mission.tasks.length) {
    // all done
    mission.running = false;
    if (mission.timer) clearInterval(mission.timer);
    mission.timer = null;
    return;
  }
  mission.busy = true;
  const task = mission.tasks[mission.cursor]!;
  mission.cursor++;
  try {
    await runMissionTask(task);
    mission.completedCount++;
    if (task.status === "filled") mission.filledCount++;
    else if (task.status === "unobtainable") mission.unobtainableCount++;
    else if (task.status === "error") mission.errorCount++;
  } finally {
    mission.busy = false;
  }
}

// Cap satellites per suggestion so a single mission run is bounded. The
// nullScan re-emits uncovered sats on the next sweep, so skipped sats get
// picked up on a later mission.
const MAX_SATS_PER_SUGGESTION = 5;

app.post<{ Body: { maxSatsPerSuggestion?: number } }>(
  "/api/sweep/mission/start",
  async (req) => {
    if (mission.running) {
      return { ok: true, alreadyRunning: true, state: publicMissionState() };
    }
    const cap = Math.max(1, Math.min(20, req.body?.maxSatsPerSuggestion ?? MAX_SATS_PER_SUGGESTION));
    const listing = await sweep.sweepRepo.list({ reviewed: false, limit: 300 });
    const tasks: MissionTask[] = [];

    for (const r of listing.rows) {
      if (!r.resolutionPayload) continue;
      // "Other / Unknown" is a catchall for unmapped operators — no single
      // datasheet covers it. Skip it.
      if (!r.operatorCountryName || r.operatorCountryName.toLowerCase().includes("unknown")) continue;
      try {
        const p = JSON.parse(r.resolutionPayload) as {
          actions?: Array<{ kind?: string; field?: string; value?: unknown; satelliteIds?: string[] }>;
        };
        const action = p.actions?.[0];
        if (!action || action.kind !== "update_field" || !action.field) continue;
        if (!MISSION_WRITABLE_COLUMNS[action.field]) continue;
        if (action.value !== null && action.value !== undefined) continue;
        const satIds = (action.satelliteIds ?? []).slice(0, cap);
        if (satIds.length === 0) continue;

        // Fetch names + NORAD ids for those sats so the LLM has a real handle.
        // Filter to object_class='payload' — debris/rocket_stage/unknown have
        // no meaningful "lifetime" / "variant" / "power" to look up.
        const satRows = await db.execute<{ id: string; name: string; norad_id: string | null }>(sql`
          SELECT id::text, name, norad_id::text
          FROM satellite
          WHERE id = ANY(${sql`ARRAY[${sql.join(satIds.map((i) => sql`${BigInt(i)}`), sql`, `)}]::bigint[]`})
            AND object_class = 'payload'
        `);
        for (const s of satRows.rows) {
          tasks.push({
            suggestionId: r.id,
            satelliteId: s.id,
            satelliteName: s.name,
            noradId: s.norad_id ? Number(s.norad_id) : null,
            field: action.field,
            operatorCountry: r.operatorCountryName,
            status: "pending",
            value: null,
            confidence: 0,
            source: null,
          });
        }
      } catch {
        // skip malformed
      }
    }
    mission.tasks = tasks;
    mission.completedCount = 0;
    mission.filledCount = 0;
    mission.unobtainableCount = 0;
    mission.errorCount = 0;
    mission.cursor = 0;
    mission.startedAt = new Date().toISOString();
    mission.running = true;
    // 1 fish at a time by default — gentle on the web-search rate limit
    mission.timer = setInterval(() => { void missionTick(); }, 1500);
    void missionTick();
    return { ok: true, state: publicMissionState() };
  },
);

app.post("/api/sweep/mission/stop", async () => {
  if (mission.timer) clearInterval(mission.timer);
  mission.timer = null;
  mission.running = false;
  return { ok: true, state: publicMissionState() };
});

app.get("/api/sweep/mission/status", async () => publicMissionState());

// ───────────────────────────────────────────────────────── reflexion pass
// Second-pass orbital analysis for a suspect payload. Builds on the KNN
// embeddings + the orbital elements already on satellite.telemetry_summary
// (raan, meanAnomaly, meanMotion, inclination) to expose two signals the
// first-pass Thalamus cycle cannot see:
//
//   1. STRICT CO-PLANE COMPANIONS — sats sharing the same (inc, raan, mm)
//      within tight tolerance + along-track phase lag in minutes. This is
//      the "tandem imaging / SIGINT pair" test.
//   2. INCLINATION-BELT PEERS — sats sharing the inclination regardless of
//      RAAN, broken down by operator_country + object_class + tier. This is
//      the "who lives in your SSO neighbourhood" test.
//
// If the peer distribution contradicts the target's DECLARED classification
// (e.g. civilian weather sat whose inclination belt is dominated by a foreign
// military power), we emit a research_finding of type anomaly with every
// suspect peer cited via similar_to edges. Cheap (SQL only, no LLM).

type ReflexionBody = { noradId: number; dIncMax?: number; dRaanMax?: number; dMmMax?: number };

app.post<{ Body: ReflexionBody }>(
  "/api/sweep/reflexion-pass",
  async (req, reply) => {
    const norad = Number(req.body?.noradId);
    if (!Number.isFinite(norad)) return reply.code(400).send({ error: "noradId required (number)" });
    const dIncMax = Math.max(0.01, Math.min(5, req.body?.dIncMax ?? 0.3));
    const dRaanMax = Math.max(0.1, Math.min(20, req.body?.dRaanMax ?? 5.0));
    const dMmMax = Math.max(0.001, Math.min(0.5, req.body?.dMmMax ?? 0.05));

    // Target row
    const tgt = await db.execute<{
      id: string;
      name: string;
      object_class: string | null;
      operator_country: string | null;
      classification_tier: string | null;
      platform_name: string | null;
      inc: number | null;
      raan: number | null;
      mm: number | null;
      ma: number | null;
      apogee: number | null;
      perigee: number | null;
    }>(sql`
      SELECT
        s.id::text AS id,
        s.name,
        s.object_class::text AS object_class,
        oc.name AS operator_country,
        s.classification_tier,
        pc.name AS platform_name,
        (s.telemetry_summary->>'inclination')::float AS inc,
        (s.telemetry_summary->>'raan')::float        AS raan,
        (s.telemetry_summary->>'meanMotion')::float  AS mm,
        (s.telemetry_summary->>'meanAnomaly')::float AS ma,
        (s.metadata->>'apogeeKm')::numeric::float    AS apogee,
        (s.metadata->>'perigeeKm')::numeric::float   AS perigee
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN platform_class pc   ON pc.id = s.platform_class_id
      WHERE s.norad_id = ${norad}
      LIMIT 1
    `);
    if (tgt.rows.length === 0) return reply.code(404).send({ error: "satellite not found" });
    const t = tgt.rows[0]!;
    if (t.inc == null || t.raan == null || t.mm == null) {
      return reply.code(400).send({ error: "target missing orbital elements" });
    }

    // 1) Strict co-plane companions + along-track phase lag
    const strict = await db.execute<{
      id: string;
      norad_id: string;
      name: string;
      operator_country: string | null;
      tier: string | null;
      object_class: string | null;
      platform: string | null;
      d_inc: number;
      d_raan: number;
      lag_min: number;
    }>(sql`
      SELECT
        s.id::text,
        s.norad_id::text,
        s.name,
        oc.name AS operator_country,
        s.classification_tier AS tier,
        s.object_class::text AS object_class,
        pc.name AS platform,
        abs((s.telemetry_summary->>'inclination')::float - ${t.inc})::float AS d_inc,
        abs((s.telemetry_summary->>'raan')::float        - ${t.raan})::float AS d_raan,
        ((((s.telemetry_summary->>'meanAnomaly')::float - ${t.ma ?? 0} + 720)::numeric % 360) / 360 * (1440.0/${t.mm}))::float AS lag_min
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN platform_class pc   ON pc.id = s.platform_class_id
      WHERE s.norad_id != ${norad}
        AND s.object_class = 'payload'
        AND abs((s.telemetry_summary->>'inclination')::float - ${t.inc}) < ${dIncMax}
        AND abs((s.telemetry_summary->>'raan')::float        - ${t.raan}) < ${dRaanMax}
        AND abs((s.telemetry_summary->>'meanMotion')::float  - ${t.mm})   < ${dMmMax}
      ORDER BY abs((s.telemetry_summary->>'inclination')::float - ${t.inc}) + abs((s.telemetry_summary->>'raan')::float - ${t.raan}) ASC
      LIMIT 30
    `);

    // 2) Inclination-belt peers (wider) — cross-tabulate by country × class
    const belt = await db.execute<{ country: string | null; tier: string | null; object_class: string | null; n: string }>(sql`
      SELECT
        oc.name AS country,
        s.classification_tier AS tier,
        s.object_class::text AS object_class,
        count(*)::text AS n
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      WHERE s.norad_id != ${norad}
        AND s.object_class = 'payload'
        AND abs((s.telemetry_summary->>'inclination')::float - ${t.inc}) < ${dIncMax}
      GROUP BY oc.name, s.classification_tier, s.object_class
      ORDER BY count(*) DESC
    `);

    // Explicit military-lineage name-match in the belt — surfaces Yaogan etc.
    const mil = await db.execute<{ id: string; norad_id: string; name: string; country: string | null; tier: string | null; d_inc: number }>(sql`
      SELECT
        s.id::text,
        s.norad_id::text,
        s.name,
        oc.name AS country,
        s.classification_tier AS tier,
        abs((s.telemetry_summary->>'inclination')::float - ${t.inc})::float AS d_inc
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      WHERE s.norad_id != ${norad}
        AND s.object_class = 'payload'
        AND abs((s.telemetry_summary->>'inclination')::float - ${t.inc}) < ${dIncMax}
        AND (
          s.name ILIKE 'YAOGAN%' OR s.name ILIKE 'USA %'   OR s.name ILIKE 'COSMOS%' OR
          s.name ILIKE 'SHIYAN%' OR s.name ILIKE 'NROL%'   OR s.name ILIKE 'LACROSSE%' OR
          s.name ILIKE 'TOPAZ%'  OR s.name ILIKE 'JANUS%'
        )
      ORDER BY d_inc ASC
      LIMIT 20
    `);

    // Decide whether to emit a finding.
    // Rule: at least one explicit MIL-lineage peer in the belt, OR the belt
    // distribution shows a different dominant country than the target's
    // declared operator_country AND the target is declared non-restricted.
    const declaredCountry = t.operator_country;
    const beltTop = belt.rows.length > 0 ? belt.rows[0]! : null;
    const mostCommonCountry = beltTop?.country ?? null;
    const divergentCountry = mostCommonCountry && declaredCountry && mostCommonCountry !== declaredCountry;

    const shouldEmit = mil.rows.length > 0 || divergentCountry;

    let findingId: bigint | null = null;
    if (shouldEmit) {
      const cycleId = await getEnrichmentCycleId();
      const title = mil.rows.length > 0
        ? `Orbital anomaly · ${t.name} shares inclination with ${mil.rows.length} military-lineage peer(s)`
        : `Orbital anomaly · ${t.name} inclination-belt dominated by ${mostCommonCountry} (declared ${declaredCountry})`;
      const summary = [
        `Target ${t.name} (NORAD ${norad}) declared ${t.object_class ?? "?"} / ${t.classification_tier ?? "?"} / ${declaredCountry ?? "?"}.`,
        `Strict co-plane companions: ${strict.rows.length}.`,
        `Inclination-belt peers at Δi<${dIncMax}°: ${belt.rows.reduce((s, r) => s + Number(r.n), 0)}, top by country = ${belt.rows.slice(0, 3).map((r) => `${r.country ?? "?"}:${r.n}`).join(", ")}.`,
        mil.rows.length > 0
          ? `MIL-lineage name-matches in belt: ${mil.rows.slice(0, 5).map((m) => `${m.name} (${m.country}, Δi=${m.d_inc.toFixed(2)}°)`).join("; ")}.`
          : "No explicit MIL-lineage name match.",
      ].join(" ");
      const evidence = [{
        source: "orbital_reflexion",
        data: {
          target: { noradId: norad, name: t.name, inc: t.inc, raan: t.raan, mm: t.mm, declared: { operator_country: declaredCountry, classification_tier: t.classification_tier, object_class: t.object_class, platform: t.platform_name } },
          strictCoplane: strict.rows.slice(0, 10).map((r) => ({ noradId: Number(r.norad_id), name: r.name, country: r.operator_country, platform: r.platform, dInc: Number(r.d_inc.toFixed(3)), dRaan: Number(r.d_raan.toFixed(2)), lagMin: Number(r.lag_min.toFixed(1)) })),
          beltByCountry: belt.rows.slice(0, 10).map((r) => ({ country: r.country, tier: r.tier, class: r.object_class, n: Number(r.n) })),
          milLineagePeers: mil.rows.map((m) => ({ noradId: Number(m.norad_id), name: m.name, country: m.country, tier: m.tier, dInc: Number(m.d_inc.toFixed(3)) })),
        },
        weight: 0.9,
      }];
      const urgency = mil.rows.length >= 1 ? "high" : "medium";
      const reasoning = "Orbital fingerprint reflexion: SQL cross-tab on (inc, raan, meanMotion) against declared classification. No LLM. Provenance: every cited peer traced via similar_to edges.";
      const created = await db.execute<{ id: string }>(sql`
        INSERT INTO research_finding
          (research_cycle_id, cortex, finding_type, status, urgency,
           title, summary, evidence, reasoning, confidence, impact_score)
        VALUES
          (${cycleId}::bigint,
           'classification_auditor'::cortex,
           'anomaly'::finding_type,
           'active'::finding_status,
           ${urgency}::urgency,
           ${title}::text,
           ${summary}::text,
           ${JSON.stringify(evidence)}::jsonb,
           ${reasoning}::text,
           ${0.8}::real,
           ${0.7}::real)
        RETURNING id::text
      `);
      findingId = BigInt(created.rows[0]!.id);
      // about → target
      const aboutCtx = JSON.stringify({ noradId: norad, declared: { operator_country: declaredCountry, tier: t.classification_tier, object_class: t.object_class } });
      await db.execute(sql`
        INSERT INTO research_edge (finding_id, entity_type, entity_id, relation, weight, context)
        VALUES (${findingId}::bigint, ${"satellite"}::entity_type, ${BigInt(t.id)}::bigint, ${"about"}::relation, ${1.0}::real, ${aboutCtx}::jsonb)
      `);
      // similar_to → each MIL peer + each strict co-plane companion
      for (const m of mil.rows.slice(0, 10)) {
        const ctx = JSON.stringify({ role: "mil_lineage_peer", dInc: Number(m.d_inc.toFixed(3)) });
        await db.execute(sql`
          INSERT INTO research_edge (finding_id, entity_type, entity_id, relation, weight, context)
          VALUES (${findingId}::bigint, ${"satellite"}::entity_type, ${BigInt(m.id)}::bigint, ${"similar_to"}::relation, ${0.9}::real, ${ctx}::jsonb)
        `);
      }
      for (const r of strict.rows.slice(0, 5)) {
        const ctx = JSON.stringify({ role: "strict_coplane", dInc: Number(r.d_inc.toFixed(3)), dRaan: Number(r.d_raan.toFixed(2)), lagMin: Number(r.lag_min.toFixed(1)) });
        await db.execute(sql`
          INSERT INTO research_edge (finding_id, entity_type, entity_id, relation, weight, context)
          VALUES (${findingId}::bigint, ${"satellite"}::entity_type, ${BigInt(r.id)}::bigint, ${"similar_to"}::relation, ${0.95}::real, ${ctx}::jsonb)
        `);
      }
    }

    return {
      target: {
        noradId: norad,
        name: t.name,
        declared: {
          operator_country: declaredCountry,
          classification_tier: t.classification_tier,
          object_class: t.object_class,
          platform: t.platform_name,
        },
        orbital: { inclinationDeg: t.inc, raanDeg: t.raan, meanMotionRevPerDay: t.mm, apogeeKm: t.apogee, perigeeKm: t.perigee },
      },
      strictCoplane: strict.rows.map((r) => ({
        noradId: Number(r.norad_id),
        name: r.name,
        country: r.operator_country,
        tier: r.tier,
        class: r.object_class,
        platform: r.platform,
        dInc: Number(r.d_inc.toFixed(3)),
        dRaan: Number(r.d_raan.toFixed(2)),
        lagMin: Number(r.lag_min.toFixed(1)),
      })),
      beltByCountry: belt.rows.map((r) => ({ country: r.country, tier: r.tier, class: r.object_class, n: Number(r.n) })),
      milLineagePeers: mil.rows.map((m) => ({ noradId: Number(m.norad_id), name: m.name, country: m.country, tier: m.tier, dInc: Number(m.d_inc.toFixed(3)) })),
      findingId: findingId ? String(findingId) : null,
    };
  },
);

// ───────────────────────────────────────────────────────── KNN propagation
// Zero-LLM enrichment: for each payload missing a field, find K nearest
// embedded neighbours with the field set and propagate their consensus value.
// Rationale: the catalogue has 18k payloads embedded (Voyage 2048-d halfvec).
// The mission fills a handful of anchors per cluster; KNN-propagation pushes
// those values to the semantic long tail at near-zero marginal cost.
//
// Accept only if: (a) nearest neighbour ≥ minSim, (b) K neighbours agree
// (numeric: all within ±10% of median ; text: mode covers ≥ ⅔). The audit
// row records the neighbour ids so every propagated value is traceable.

type KnnPropagateBody = {
  field?: string;
  k?: number;
  minSim?: number;
  limit?: number;
  dryRun?: boolean;
};

app.post<{ Body: KnnPropagateBody }>(
  "/api/sweep/mission/knn-propagate",
  async (req, reply) => {
    const field = req.body?.field ?? "";
    if (!MISSION_WRITABLE_COLUMNS[field]) {
      return reply.code(400).send({ error: `field must be one of ${Object.keys(MISSION_WRITABLE_COLUMNS).join(", ")}` });
    }
    const k = Math.max(3, Math.min(15, req.body?.k ?? 5));
    const minSim = Math.max(0.5, Math.min(0.99, req.body?.minSim ?? 0.8));
    const limit = Math.max(1, Math.min(2000, req.body?.limit ?? 500));
    const dryRun = req.body?.dryRun === true;
    const kind = MISSION_WRITABLE_COLUMNS[field];
    // cosine-distance threshold (pgvector returns distance, lower = closer).
    // cos_distance = 1 - cosine_similarity → minSim=0.8 → maxDist=0.2.
    const maxDist = 1 - minSim;

    // Candidates: payloads where the field IS null, with embedding.
    const fieldSql = field === "variant"
      ? sql`variant`
      : field === "lifetime"
        ? sql`lifetime`
        : field === "power"
          ? sql`power`
          : field === "mass_kg"
            ? sql`mass_kg`
            : sql`launch_year`;

    const targets = await db.execute<{ id: string; name: string }>(sql`
      SELECT id::text, name
      FROM satellite
      WHERE object_class = 'payload'
        AND embedding IS NOT NULL
        AND ${fieldSql} IS NULL
      LIMIT ${limit}
    `);

    const stats = {
      field,
      k,
      minSim,
      attempted: 0,
      filled: 0,
      disagree: 0,
      tooFar: 0,
      outOfRange: 0,
      sampleFills: [] as Array<{ id: string; name: string; value: string | number; neighbourIds: string[]; cosSim: number }>,
    };

    for (const t of targets.rows) {
      stats.attempted++;
      const tid = BigInt(t.id);

      // K nearest PAYLOAD neighbours with the field set.
      const neighbours = await db.execute<{
        id: string;
        value: string | number | null;
        cos_distance: number;
      }>(sql`
        SELECT
          s.id::text AS id,
          s.${fieldSql} AS value,
          (s.embedding <=> t.embedding)::float AS cos_distance
        FROM satellite s, (SELECT embedding FROM satellite WHERE id = ${tid}) t
        WHERE s.id != ${tid}
          AND s.object_class = 'payload'
          AND s.${fieldSql} IS NOT NULL
          AND s.embedding IS NOT NULL
        ORDER BY s.embedding <=> t.embedding
        LIMIT ${k}
      `);

      if (neighbours.rows.length < 3) { stats.tooFar++; continue; }
      const nearest = neighbours.rows[0]!;
      if (nearest.cos_distance > maxDist) { stats.tooFar++; continue; }

      // Consensus — range-guard each neighbour first.
      const values: Array<string | number> = [];
      for (const n of neighbours.rows) {
        if (n.value == null) continue;
        if (kind === "numeric") {
          const num = typeof n.value === "number" ? n.value : Number.parseFloat(String(n.value));
          if (!Number.isFinite(num) || !inRange(field, num)) { stats.outOfRange++; continue; }
          values.push(num);
        } else {
          values.push(String(n.value).trim().toLowerCase());
        }
      }
      if (values.length < 3) { stats.tooFar++; continue; }

      let consensus: string | number | null = null;
      if (kind === "numeric") {
        const nums = (values as number[]).slice().sort((a, b) => a - b);
        const median = nums[Math.floor(nums.length / 2)]!;
        const denom = Math.max(Math.abs(median), 1e-9);
        const allClose = nums.every((v) => Math.abs(v - median) / denom <= 0.1);
        if (allClose) consensus = median;
      } else {
        const freq = new Map<string, number>();
        for (const v of values) freq.set(String(v), (freq.get(String(v)) ?? 0) + 1);
        let top: [string, number] | null = null;
        for (const [val, n] of freq) if (!top || n > top[1]) top = [val, n];
        if (top && top[1] / values.length >= 0.66) consensus = top[0];
      }

      if (consensus == null) { stats.disagree++; continue; }

      const cosSim = 1 - nearest.cos_distance;
      const neighbourIds = neighbours.rows.map((n) => n.id);

      if (!dryRun) {
        await applyKnnFill(t.id, field, consensus, neighbourIds, cosSim);
      }
      stats.filled++;
      if (stats.sampleFills.length < 10) {
        stats.sampleFills.push({
          id: t.id,
          name: t.name,
          value: consensus,
          neighbourIds: neighbourIds.slice(0, 3),
          cosSim: Number(cosSim.toFixed(3)),
        });
      }
    }

    return stats;
  },
);

// Long-running synthetic cycle that carries every enrichment finding emitted
// by KNN-propagation and web-mission. Lazily created on first call, cached.
let enrichmentCycleId: bigint | null = null;

async function getEnrichmentCycleId(): Promise<bigint> {
  if (enrichmentCycleId != null) return enrichmentCycleId;
  // Reuse the most recent running/completed "system-enrichment" cycle if any
  const existing = await db.execute<{ id: string }>(sql`
    SELECT id::text FROM research_cycle
    WHERE trigger_source = 'catalog-enrichment'
    ORDER BY id DESC LIMIT 1
  `);
  if (existing.rows[0]) {
    enrichmentCycleId = BigInt(existing.rows[0].id);
    return enrichmentCycleId;
  }
  // Create a fresh one — marks the continuous enrichment stream.
  const created = await db.execute<{ id: string }>(sql`
    INSERT INTO research_cycle (trigger_type, trigger_source, status, findings_count)
    VALUES ('system'::cycle_trigger, 'catalog-enrichment', 'running'::cycle_status, 0)
    RETURNING id::text
  `);
  enrichmentCycleId = BigInt(created.rows[0]!.id);
  return enrichmentCycleId;
}

/**
 * Emit a research_finding + research_edges for a catalog enrichment so that
 * Thalamus cortices can reason on factual, traceable fills.
 *
 * Two flavours:
 *   - "knn"     → edges relation=similar_to, one per neighbour
 *   - "mission" → edge relation=supports to the satellite, source URL in evidence
 */
async function emitEnrichmentFinding(args: {
  kind: "knn" | "mission";
  satelliteId: string;
  field: string;
  value: string | number;
  confidence: number;
  source: string;
  neighbourIds?: string[];       // knn only
  cosSim?: number;               // knn only
}): Promise<void> {
  const cycleId = await getEnrichmentCycleId();
  const satBig = BigInt(args.satelliteId);
  const title = `${args.kind === "knn" ? "KNN" : "Mission"} fill · ${args.field}=${args.value}`;
  const summary = args.kind === "knn"
    ? `${args.field} propagated to satellite #${args.satelliteId} from ${args.neighbourIds?.length ?? 0} semantically similar payloads (cos_sim=${args.cosSim?.toFixed(3) ?? "?"}).`
    : `${args.field} written to satellite #${args.satelliteId} from web-search source (confidence=${args.confidence.toFixed(2)}).`;

  const evidence = args.kind === "knn"
    ? [{
        source: "knn",
        data: { field: args.field, value: args.value, cosSim: args.cosSim, neighbours: args.neighbourIds ?? [] },
        weight: args.confidence,
      }]
    : [{
        source: "web",
        data: { field: args.field, value: args.value, url: args.source },
        weight: args.confidence,
      }];

  const reasoning = args.kind === "knn"
    ? `Zero-LLM propagation: median consensus of K=${args.neighbourIds?.length ?? 0} nearest payloads in Voyage halfvec(2048) space.`
    : `Web-mission 2-vote corroboration: two independent nano calls agreed on this value from ${args.source}.`;

  const evidenceJson = JSON.stringify(evidence);
  const created = await db.execute<{ id: string }>(sql`
    INSERT INTO research_finding
      (research_cycle_id, cortex, finding_type, status, urgency,
       title, summary, evidence, reasoning, confidence, impact_score)
    VALUES
      (${cycleId}::bigint,
       'data_auditor'::cortex,
       'insight'::finding_type,
       'active'::finding_status,
       'low'::urgency,
       ${title}::text,
       ${summary}::text,
       ${evidenceJson}::jsonb,
       ${reasoning}::text,
       ${args.confidence}::real,
       ${0.3}::real)
    RETURNING id::text
  `);
  const findingId = BigInt(created.rows[0]!.id);

  // Edge: finding about target satellite (both flavours)
  const aboutCtx = JSON.stringify({ field: args.field, value: String(args.value) });
  await db.execute(sql`
    INSERT INTO research_edge (finding_id, entity_type, entity_id, relation, weight, context)
    VALUES (${findingId}::bigint, 'satellite'::entity_type, ${satBig}::bigint, 'about'::relation, ${1.0}::real,
            ${aboutCtx}::jsonb)
  `);

  // KNN: similar_to edges back to each neighbour that voted
  if (args.kind === "knn" && args.neighbourIds?.length) {
    const neighbourCtx = JSON.stringify({ role: "knn_neighbour", cosSim: args.cosSim ?? null });
    for (const nid of args.neighbourIds.slice(0, 10)) {
      await db.execute(sql`
        INSERT INTO research_edge (finding_id, entity_type, entity_id, relation, weight, context)
        VALUES (${findingId}::bigint, 'satellite'::entity_type, ${BigInt(nid)}::bigint, 'similar_to'::relation,
                ${args.cosSim ?? 0.8}::real,
                ${neighbourCtx}::jsonb)
      `);
    }
  }

  // Feedback loop — tell the next nano-sweep this (field × country) is
  // self-healing via KNN so it can deprioritise web-mission spend.
  await redis.lpush(
    "sweep:feedback",
    JSON.stringify({
      category: "enrichment",
      wasAccepted: true,
      reviewerNote: `${args.kind}-fill: ${args.field}=${args.value}`,
      operatorCountryName: args.kind === "knn" ? "knn-propagation" : "web-mission",
    }),
  );
  await redis.ltrim("sweep:feedback", 0, 199);
}

async function applyKnnFill(
  satelliteId: string,
  field: string,
  value: string | number,
  neighbourIds: string[],
  cosSim: number,
): Promise<void> {
  const kind = MISSION_WRITABLE_COLUMNS[field];
  const coerced = kind === "numeric" ? Number(value) : String(value);
  const satBigInt = BigInt(satelliteId);

  if (field === "variant") {
    await db.execute(sql`UPDATE satellite SET variant = ${coerced} WHERE id = ${satBigInt}`);
  } else if (field === "lifetime") {
    await db.execute(sql`UPDATE satellite SET lifetime = ${coerced} WHERE id = ${satBigInt}`);
  } else if (field === "power") {
    await db.execute(sql`UPDATE satellite SET power = ${coerced} WHERE id = ${satBigInt}`);
  } else if (field === "mass_kg") {
    await db.execute(sql`UPDATE satellite SET mass_kg = ${coerced} WHERE id = ${satBigInt}`);
  } else if (field === "launch_year") {
    await db.execute(sql`UPDATE satellite SET launch_year = ${coerced} WHERE id = ${satBigInt}`);
  }

  const source = `knn_propagation:k=${neighbourIds.length},cosSim=${cosSim.toFixed(3)},neighbours=[${neighbourIds.slice(0, 5).join(",")}]`;
  const payloadJson = JSON.stringify({ field, value: coerced, source, neighbourIds, cosSim });
  await db.execute(sql`
    INSERT INTO sweep_audit (
      suggestion_id, operator_country_name, category, severity,
      title, description, suggested_action, affected_satellites,
      web_evidence, accepted, resolution_status, resolution_payload, reviewed_at
    ) VALUES (
      ${`knn:${satelliteId}:${field}`},
      ${"knn-propagation"},
      ${"enrichment"}::sweep_category,
      ${"info"}::sweep_severity,
      ${`KNN-fill ${field}=${coerced} on satellite ${satelliteId}`},
      ${""},
      ${`UPDATE satellite SET ${field}=${coerced} (knn)`},
      ${1},
      ${source},
      ${true},
      ${"success"}::sweep_resolution_status,
      ${payloadJson}::jsonb,
      NOW()
    )
  `);

  // Emit a research_finding so Thalamus cortices can reason on this fill.
  await emitEnrichmentFinding({
    kind: "knn",
    satelliteId,
    field,
    value: coerced,
    confidence: Math.max(0.5, Math.min(0.95, cosSim)),
    source,
    neighbourIds,
    cosSim,
  });
}

function publicMissionState() {
  return {
    running: mission.running,
    startedAt: mission.startedAt,
    total: mission.tasks.length,
    completed: mission.completedCount,
    filled: mission.filledCount,
    unobtainable: mission.unobtainableCount,
    errors: mission.errorCount,
    cursor: mission.cursor,
    currentTask: mission.running && mission.cursor > 0 ? mission.tasks[mission.cursor - 1] : null,
    recent: mission.tasks
      .filter((t) => t.status !== "pending")
      .slice(-20)
      .reverse(),
  };
}

function publicAutonomyState() {
  return {
    running: autonomy.running,
    intervalMs: autonomy.intervalMs,
    startedAt: autonomy.startedAt,
    tickCount: autonomy.tickCount,
    currentTick: autonomy.currentTick,
    history: autonomy.history.slice(0, 20),
    nextTickInMs: autonomy.running && autonomy.startedAt
      ? Math.max(0, autonomy.intervalMs - ((Date.now() - (autonomy.history[0] ? new Date(autonomy.history[0].startedAt).getTime() : Date.now())) % autonomy.intervalMs))
      : null,
  };
}

async function runThalamus(query: string): Promise<number> {
  const cycle = await thalamus.thalamusService.runCycle({
    query,
    triggerType: TRIGGER_USER as unknown as never,
    triggerSource: "console-ui",
  });
  return cycle.findingsCount ?? 0;
}

async function runFish(): Promise<number> {
  // nullScan is deterministic: emits 1 suggestion per (operator_country × nullable column)
  // — exactly the "find what humans miss" sweep kernel the product promises.
  const result = await sweep.nanoSweepService.sweep(20, "nullScan");
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

  const byStatusRaw = await db.execute<{ status: string; count: number }>(sql`
    SELECT status::text, count(*)::int FROM research_finding GROUP BY status
  `);
  const byStatusMapped = new Map<string, number>();
  for (const r of byStatusRaw.rows) {
    const mapped = mapFindingStatus(r.status);
    byStatusMapped.set(mapped, (byStatusMapped.get(mapped) ?? 0) + Number(r.count));
  }
  const byStatus = { rows: [...byStatusMapped].map(([status, count]) => ({ status, count })) };
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
const CONSOLE_CHAT_SYSTEM_PROMPT = `You are the SSA mission-operator assistant in the Thalamus + Sweep web console.
You chat with a non-technical reviewer. Keep answers under 120 words, in the reviewer's language.
You CAN explain: catalog contents, conjunction concepts, sim-fish swarms, confidence bands (FIELD/OSINT/SIM), findings.
If the reviewer asks to RUN something (research cycle, detect anomalies, analyze a satellite), say you are dispatching it and name the query you are about to run.
Never invent satellite numbers or Pc values — only cite numbers that appear in the findings bundle attached to this prompt, if any.`;

const CLASSIFIER_SYSTEM_PROMPT = `You are a router. Read the user's message and output STRICT JSON with one of:
{"action":"chat"}                                   — pure conversation, no data needed
{"action":"run_cycle","query":"<refined query>"}    — user wants a Thalamus research cycle: detect / analyze / find / audit / investigate / screen / run / lance / détecte / analyse
Output JSON only, no prose.`;

app.post<{ Body: { input: string } }>(
  "/api/repl/chat",
  async (req, reply) => {
    const { input } = req.body ?? ({} as { input: string });
    if (!input || typeof input !== "string") {
      return reply.code(400).send({ error: "input required" });
    }
    const t0 = Date.now();

    // Step 1 — classify intent.
    const classifier = createLlmTransportWithMode(CLASSIFIER_SYSTEM_PROMPT);
    const routed = await classifier.call(input);
    let intent: { action: "chat" } | { action: "run_cycle"; query: string };
    try {
      const m = routed.content.match(/\{[\s\S]*\}/);
      intent = m ? JSON.parse(m[0]) : { action: "chat" };
    } catch {
      intent = { action: "chat" };
    }

    // Step 2a — plain chat.
    if (intent.action === "chat") {
      const transport = createLlmTransportWithMode(CONSOLE_CHAT_SYSTEM_PROMPT);
      const response = await transport.call(input);
      return {
        kind: "chat" as const,
        text: response.content,
        provider: response.provider,
        tookMs: Date.now() - t0,
      };
    }

    // Step 2b — dispatch a Thalamus cycle, then summarize findings with LLM.
    const cycle = await thalamus.thalamusService.runCycle({
      query: intent.query,
      triggerType: TRIGGER_USER as unknown as never,
      triggerSource: "console-chat",
    });
    const findings = await thalamus.findingRepo.findByCycleId(cycle.id);
    const top = findings.slice(0, 8).map((f) => ({
      id: String(f.id),
      title: f.title ?? f.summary?.slice(0, 80) ?? "(no title)",
      summary: f.summary?.slice(0, 300) ?? null,
      cortex: f.cortex,
      urgency: f.urgency,
      confidence: Number(f.confidence ?? 0),
    }));
    const summarizer = createLlmTransportWithMode(
      `You are an SSA briefing writer. The user asked: "${input}"
A Thalamus research cycle just ran. Summarize the findings below in <150 words, in the user's language.
For each finding worth flagging, cite its id (#id) and the satellite name(s) linked to it.
If findings is empty, say so and suggest one concrete narrower follow-up.
Never invent numbers.`,
    );
    const payload = JSON.stringify({ cycleId: String(cycle.id), findings: top }, null, 2);
    const summary = await summarizer.call(payload);
    return {
      kind: "chat" as const,
      text:
        `▶ dispatched Thalamus cycle (${findings.length} finding${findings.length === 1 ? "" : "s"})\n\n` +
        summary.content,
      provider: summary.provider,
      tookMs: Date.now() - t0,
    };
  },
);

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

let corsRegistered = false;
async function ensureCors(): Promise<void> {
  if (corsRegistered) return;
  await app.register(cors, { origin: true });
  corsRegistered = true;
}

export { app };

export async function startServer(
  port: number = Number(process.env.PORT ?? 4000),
): Promise<{ app: typeof app; port: number; close: () => Promise<void> }> {
  await ensureCors();
  const address = await app.listen({ port, host: "0.0.0.0" });
  const boundPort = (() => {
    const m = address.match(/:(\d+)$/);
    return m ? Number(m[1]) : port;
  })();
  app.log.info(`console-api listening on :${boundPort}`);
  return { app, port: boundPort, close: async () => { await app.close(); } };
}

async function main(): Promise<void> {
  await startServer();
}

// Only auto-boot when run as the entrypoint (not when imported by tests).
// Under vitest, VITEST=true is set automatically; importing this module must
// not start listening.
const isVitest = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
if (!isVitest) {
  main().catch((err) => {
    app.log.error({ err: err instanceof Error ? err.message : String(err) }, "boot failed");
    process.exit(1);
  });
}

/**
 * REPL turn engine — inlined parser + fixture-backed adapters.
 * Mirrors packages/cli/src/router for a deterministic demo backend.
 */
import type { FindingDTO, KgEdgeDTO, KgNodeDTO, SatelliteDTO } from "./fixtures";
// Inline minimal mirror of STEP_REGISTRY from @interview/shared. Keeping it inline
// avoids Node ESM named-export analysis failures on a .ts-main workspace package.
type StepName =
  | "cycle" | "planner" | "cortex" | "nano.call"
  | "fetch.osint" | "fetch.field" | "curator.dedup" | "kg.write"
  | "guardrail.breach" | "reflexion" | "swarm"
  | "fish.spawn" | "fish.perturb" | "fish.turn"
  | "fish.memory.read" | "fish.memory.write"
  | "aggregator" | "suggestion.emit" | "swarm.fail-soft";

const STEP_REGISTRY: Record<StepName, { terminal: string }> = {
  cycle: { terminal: "🏁" }, planner: { terminal: "📍" }, cortex: { terminal: "✅" },
  "nano.call": { terminal: "✨" }, "fetch.osint": { terminal: "📥" }, "fetch.field": { terminal: "📥" },
  "curator.dedup": { terminal: "🧴" }, "kg.write": { terminal: "📚" }, "guardrail.breach": { terminal: "🚧" },
  reflexion: { terminal: "🪞" }, swarm: { terminal: "🏆" }, "fish.spawn": { terminal: "🐟" },
  "fish.perturb": { terminal: "🎯" }, "fish.turn": { terminal: "🎣" }, "fish.memory.read": { terminal: "📚" },
  "fish.memory.write": { terminal: "💽" }, aggregator: { terminal: "🎯" },
  "suggestion.emit": { terminal: "💡" }, "swarm.fail-soft": { terminal: "🚨" },
};
export type { StepName };

// ---------- Step schema (inlined mirror of @interview/cli) ----------
export type Step =
  | { action: "query"; q: string }
  | { action: "telemetry"; satId: string }
  | { action: "logs"; level?: "debug" | "info" | "warn" | "error"; service?: string; sinceMs?: number }
  | { action: "graph"; entity: string }
  | { action: "accept"; suggestionId: string }
  | { action: "explain"; findingId: string }
  | { action: "pc"; conjunctionId: string }
  | { action: "clarify"; question: string; options: Array<"query" | "telemetry" | "logs" | "graph" | "accept" | "explain" | "pc"> };

export type RouterPlan = { steps: Step[]; confidence: number };

const VERBS = new Set(["query", "telemetry", "logs", "graph", "accept", "explain", "pc"]);
const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export function parseExplicitCommand(input: string): RouterPlan | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawVerb, ...rest] = trimmed.slice(1).split(/\s+/);
  if (!rawVerb || !VERBS.has(rawVerb)) return null;
  const args = rest.join(" ").trim();
  switch (rawVerb) {
    case "query":
      if (!args) return null;
      return { steps: [{ action: "query", q: args }], confidence: 1 };
    case "telemetry":
      if (!args) return null;
      return { steps: [{ action: "telemetry", satId: args.split(/\s+/)[0]! }], confidence: 1 };
    case "graph":
      if (!args) return null;
      return { steps: [{ action: "graph", entity: args }], confidence: 1 };
    case "accept":
      if (!args) return null;
      return { steps: [{ action: "accept", suggestionId: args.split(/\s+/)[0]! }], confidence: 1 };
    case "explain":
      if (!args) return null;
      return { steps: [{ action: "explain", findingId: args.split(/\s+/)[0]! }], confidence: 1 };
    case "pc":
      if (!args) return null;
      return { steps: [{ action: "pc", conjunctionId: args.split(/\s+/)[0]! }], confidence: 1 };
    case "logs": {
      const flags = Object.fromEntries(
        args.split(/\s+/).filter(Boolean).map((kv) => {
          const [k, v] = kv.split("=");
          return [k, v];
        }),
      );
      const level = flags.level && (LOG_LEVELS as readonly string[]).includes(flags.level)
        ? (flags.level as typeof LOG_LEVELS[number]) : undefined;
      const service = flags.service;
      return { steps: [{ action: "logs", ...(level && { level }), ...(service && { service }) }], confidence: 1 };
    }
  }
  return null;
}

/**
 * Heuristic router for free-text input. No LLM — deterministic regex.
 * Priority: accept > explain > telemetry > logs > graph > query(fallback).
 */
export function heuristicRoute(input: string): RouterPlan {
  const t = input.trim();
  const low = t.toLowerCase();
  // accept: "accept SWEEP-001" / finding id
  const acceptM = low.match(/\b(accept|approve|commit)\b.*?([a-z]+-?\d+|f:\d+|sweep-\d+)/i);
  if (acceptM) return { steps: [{ action: "accept", suggestionId: acceptM[2]!.toUpperCase() }], confidence: 0.7 };
  // explain: "why ..." or "explain ..."
  const explainM = low.match(/\b(why|explain|reason)\b.*?(f:\d+|[a-z]+-?\d+)/i);
  if (explainM) return { steps: [{ action: "explain", findingId: explainM[2]! }], confidence: 0.7 };
  // pc: collision probability / hit probability
  const pcM = low.match(/\b(pc|collision probability|hit probability|probability of collision)\b.*?(ce[:\-]?\d+|conj[:\-]?\d+|\d+)/i);
  if (pcM) {
    let id = pcM[2]!;
    if (/^\d+$/.test(id)) id = `ce:${id}`;
    return { steps: [{ action: "pc", conjunctionId: id }], confidence: 0.7 };
  }
  if (/\b(pc|collision probability|hit probability)\b/i.test(low)) {
    return { steps: [{ action: "pc", conjunctionId: "ce:1" }], confidence: 0.5 };
  }
  // telemetry
  if (/\b(tlm|telemetry|telem)\b/i.test(low) || /\b\d{4,6}\b/.test(low) && /\b(sat|norad|satellite)\b/.test(low)) {
    const num = t.match(/\b\d{4,6}\b/);
    return { steps: [{ action: "telemetry", satId: num ? num[0] : "25544" }], confidence: 0.6 };
  }
  // logs
  if (/\b(logs?|tail|events?)\b/i.test(low)) {
    return { steps: [{ action: "logs" }], confidence: 0.6 };
  }
  // graph
  const graphM = low.match(/\b(graph|neighbou?rhood|connected|links?)\b.*?([a-z]+:[a-z0-9_-]+|[a-z]+-\d+)/i);
  if (graphM) return { steps: [{ action: "graph", entity: graphM[2]! }], confidence: 0.6 };
  if (/\b(graph|neighbou?rhood)\b/i.test(low)) {
    return { steps: [{ action: "graph", entity: "regime:LEO" }], confidence: 0.4 };
  }
  // fallback: query
  return { steps: [{ action: "query", q: t }], confidence: 0.3 };
}

// ---------- Dispatch results ----------
export type DispatchResult =
  | {
      kind: "briefing";
      executiveSummary: string;
      findings: BriefingFinding[];
      recommendedActions: string[];
      followUpPrompts: string[];
      uiActions: BriefingUiAction[];
      costUsd: number;
    }
  | { kind: "telemetry"; satId: string; satName: string; distribution: TelemetryEntry[] }
  | { kind: "logs"; events: LogEvent[] }
  | { kind: "graph"; root: string; tree: GraphNode }
  | { kind: "resolution"; suggestionId: string; ok: boolean; delta: { findingId: string } }
  | { kind: "why"; findingId: string; tree: WhyNode; stats: WhyStats }
  | { kind: "pc"; conjunctionId: string; estimate: PcEstimate }
  | { kind: "clarify"; question: string; options: string[] };

export type BriefingUiAction =
  | {
      kind: "open_feed";
      target: "autonomy";
      label: string;
    }
  | {
      kind: "open_config";
      domain: "console.autonomy" | "thalamus.budgets";
      label: string;
    };

export type PcCluster = {
  mode: string;
  flags: string[];
  pcRange: [number, number];
  fishCount: number;
};
export type PcEstimate = {
  medianPc: number;
  sigmaPc: number;
  p5Pc: number;
  p95Pc: number;
  fishCount: number;
  histogramBins: Array<{ log10Pc: number; count: number }>;
  clusters: PcCluster[];
  severity: "info" | "medium" | "high";
  suggestionId?: string;
};

export type BriefingFinding = {
  id: string;
  summary: string;
  sourceClass: "field" | "osint" | "derived";
  confidence: number;
  evidenceRefs: string[];
};

export type TelemetryEntry = {
  name: string;
  unit: string;
  median: number;
  p5: number;
  p95: number;
};

export type LogEvent = {
  time: string;
  level: "debug" | "info" | "warn" | "error";
  service: string;
  msg: string;
  step?: StepName;
  phase?: "start" | "progress" | "done" | "error";
};

export type GraphNode = { id: string; label: string; class: string; children: GraphNode[] };
export type WhyNode = {
  id?: string;
  label: string;
  kind: "finding" | "edge" | "source_item" | "evidence";
  detail?: string;
  sha256?: string;
  sourceClass?: "field" | "osint" | "sim" | "derived";
  children: WhyNode[];
};
export type WhyStats = { edges: number; sourceItems: number; byClass: { field: number; osint: number; sim: number } };

// ---------- Deterministic RNG per-session ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------- Adapters backed by fixtures ----------
export type Fixtures = {
  satellites: SatelliteDTO[];
  kgNodes: KgNodeDTO[];
  kgEdges: KgEdgeDTO[];
  findings: FindingDTO[];
};

const TELEM_TEMPLATES: Array<{ name: string; unit: string; base: number; jitter: number }> = [
  { name: "bus.voltage.main", unit: "V", base: 28.0, jitter: 0.4 },
  { name: "bus.current.load", unit: "A", base: 3.2, jitter: 0.6 },
  { name: "battery.soc", unit: "%", base: 84, jitter: 8 },
  { name: "battery.temp", unit: "C", base: 18, jitter: 3 },
  { name: "thermal.panel.a", unit: "C", base: 42, jitter: 6 },
  { name: "thermal.panel.b", unit: "C", base: -18, jitter: 5 },
  { name: "adcs.rate.x", unit: "deg/s", base: 0.002, jitter: 0.004 },
  { name: "adcs.rate.y", unit: "deg/s", base: -0.001, jitter: 0.004 },
  { name: "adcs.rate.z", unit: "deg/s", base: 0.003, jitter: 0.004 },
  { name: "gnc.position.err", unit: "m", base: 12, jitter: 4 },
  { name: "rf.downlink.snr", unit: "dB", base: 14.6, jitter: 1.8 },
  { name: "rf.uplink.rssi", unit: "dBm", base: -92, jitter: 4 },
  { name: "payload.duty", unit: "%", base: 63, jitter: 12 },
  { name: "cpu.load", unit: "%", base: 41, jitter: 9 },
];

const LOG_SERVICES = ["thalamus", "sweep", "fish-swarm", "kg-writer", "osint-ingest", "field-ingest"];
const STEP_NAMES = Object.keys(STEP_REGISTRY) as StepName[];
const LOG_MESSAGES: Record<string, string[]> = {
  thalamus: [
    "cycle started",
    "planner produced 4 substeps",
    "cortex:catalog reached consensus",
    "writing 12 suggestions to KG",
  ],
  sweep: [
    "sim-fish perturbation batch dispatched",
    "aggregator collapsed 83 proposals → 12",
    "guardrail OK under budget",
  ],
  "fish-swarm": ["fish.spawn k=30", "fish.turn converging", "fish.memory.write delta=0.02"],
  "kg-writer": ["kg.write committed 7 nodes 14 edges", "dedup pruned 3"],
  "osint-ingest": ["celestrak TLE refresh 600 sats", "seen 4 new objects"],
  "field-ingest": ["radar site-07 heartbeat", "track residual 1.8σ"],
};

export function makeAdapters(fx: Fixtures) {
  return {
    async query(step: Extract<Step, { action: "query" }>, seed: number): Promise<DispatchResult> {
      const rnd = mulberry32(seed);
      const n = 2 + Math.floor(rnd() * 4); // 2..5
      // pick findings matching keywords loosely
      const q = step.q.toLowerCase();
      const keyword = q.match(/conjunction|maneuver|stale|osint|radar|correlation/)?.[0];
      const pool = keyword
        ? fx.findings.filter((f) => f.title.toLowerCase().includes(keyword) || f.cortex.toLowerCase().includes(keyword))
        : fx.findings;
      const picked = (pool.length > 0 ? pool : fx.findings).slice(0, 200);
      const chosen: FindingDTO[] = [];
      for (let i = 0; i < n && picked.length > 0; i++) {
        const idx = Math.floor(rnd() * picked.length);
        const f = picked[idx]!;
        if (!chosen.includes(f)) chosen.push(f);
      }
      const findings: BriefingFinding[] = chosen.map((f) => {
        const hasField = f.evidence.some((e) => e.kind === "field");
        const hasOsint = f.evidence.some((e) => e.kind === "osint");
        const sourceClass: BriefingFinding["sourceClass"] = hasField ? "field" : hasOsint ? "osint" : "derived";
        return {
          id: f.id,
          summary: f.title,
          sourceClass,
          confidence: Math.min(1, 0.3 + (f.priority / 100) * 0.7),
          evidenceRefs: f.evidence.map((e) => e.uri),
        };
      });
      const regimes = new Set(chosen.flatMap((c) => c.linkedEntityIds.filter((x) => x.startsWith("regime:"))));
      const satCount = chosen.flatMap((c) => c.linkedEntityIds.filter((x) => x.startsWith("sat:"))).length;
      const executiveSummary = `Research cycle inspected ${satCount || 8 + Math.floor(rnd() * 30)} satellites across ${regimes.size || 2} regimes; surfaced ${findings.length} candidates.`;
      const top = findings[0];
      const recommendedActions = top
        ? [
            `/explain ${top.id}`,
            `/accept ${top.id}`,
            top.sourceClass !== "field" ? `/query corroborate ${top.id} with field evidence` : `/graph sat:${chosen[0]!.linkedEntityIds.find((x) => x.startsWith("sat:")) ?? "1"}`,
          ]
        : [];
      const followUpPrompts = [
        `why is ${top?.id ?? "f:1"} high priority`,
        `telemetry for top linked satellite`,
        `graph neighbourhood around ${top?.id ?? "f:1"}`,
      ];
      const uiActions = buildBriefingUiActions(step.q);
      const costUsd = 0.01 + rnd() * 0.04;
      return {
        kind: "briefing",
        executiveSummary,
        findings,
        recommendedActions,
        followUpPrompts,
        uiActions,
        costUsd,
      };
    },

    async telemetry(step: Extract<Step, { action: "telemetry" }>, seed: number): Promise<DispatchResult> {
      const rnd = mulberry32(seed);
      // satId may be NORAD or numeric id; find or fall back random
      const asNum = Number(step.satId);
      const sat =
        fx.satellites.find((s) => s.noradId === asNum) ??
        fx.satellites.find((s) => String(s.id) === step.satId) ??
        fx.satellites.find((s) => s.name.toLowerCase() === step.satId.toLowerCase()) ??
        fx.satellites[Math.floor(rnd() * fx.satellites.length)]!;
      const count = 8 + Math.floor(rnd() * 7); // 8..14
      const picked = TELEM_TEMPLATES.slice(0, count);
      const distribution: TelemetryEntry[] = picked.map((t) => {
        const median = t.base + (rnd() - 0.5) * t.jitter * 0.5;
        const spread = t.jitter * (0.6 + rnd() * 0.8);
        return {
          name: t.name,
          unit: t.unit,
          median: Number(median.toFixed(3)),
          p5: Number((median - spread).toFixed(3)),
          p95: Number((median + spread).toFixed(3)),
        };
      });
      return { kind: "telemetry", satId: String(sat.noradId), satName: sat.name, distribution };
    },

    async logs(_step: Extract<Step, { action: "logs" }>, seed: number): Promise<DispatchResult> {
      const rnd = mulberry32(seed);
      const now = Date.now();
      const events: LogEvent[] = [];
      for (let i = 0; i < 10; i++) {
        const service = LOG_SERVICES[Math.floor(rnd() * LOG_SERVICES.length)]!;
        const msgs = LOG_MESSAGES[service] ?? ["tick"];
        const step = STEP_NAMES[Math.floor(rnd() * STEP_NAMES.length)]!;
        const phaseR = rnd();
        const phase: LogEvent["phase"] = phaseR < 0.2 ? "start" : phaseR < 0.7 ? "progress" : phaseR < 0.95 ? "done" : "error";
        events.push({
          time: new Date(now - (9 - i) * 1200 - Math.floor(rnd() * 400)).toISOString(),
          level: phase === "error" ? "error" : rnd() < 0.1 ? "warn" : "info",
          service,
          step,
          phase,
          msg: msgs[Math.floor(rnd() * msgs.length)]!,
        });
      }
      return { kind: "logs", events };
    },

    async graph(step: Extract<Step, { action: "graph" }>, _seed: number): Promise<DispatchResult> {
      const rootId = step.entity;
      const byId = new Map(fx.kgNodes.map((n) => [n.id, n]));
      const adj = new Map<string, string[]>();
      fx.kgEdges.forEach((e) => {
        adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
        adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
      });
      const seen = new Set<string>([rootId]);
      let cap = 50;
      const build = (id: string, depth: number): GraphNode => {
        const n = byId.get(id);
        const node: GraphNode = { id, label: n?.label ?? id, class: n?.class ?? "Unknown", children: [] };
        if (depth <= 0 || cap <= 0) return node;
        const nbrs = adj.get(id) ?? [];
        for (const c of nbrs) {
          if (seen.has(c) || cap <= 0) continue;
          seen.add(c);
          cap--;
          node.children.push(build(c, depth - 1));
        }
        return node;
      };
      const tree = build(rootId, 2);
      return { kind: "graph", root: rootId, tree };
    },

    async accept(step: Extract<Step, { action: "accept" }>): Promise<DispatchResult> {
      // tolerate both "f:123" and "SWEEP-001" aliases by looking up or creating
      let f = fx.findings.find((x) => x.id === step.suggestionId || x.id.toLowerCase() === step.suggestionId.toLowerCase());
      if (!f) f = fx.findings[0]!;
      f.status = "accepted";
      return { kind: "resolution", suggestionId: f.id, ok: true, delta: { findingId: f.id } };
    },

    async pc(step: Extract<Step, { action: "pc" }>, seed: number): Promise<DispatchResult> {
      const rnd = mulberry32(seed);
      // log-normal around 3e-4 with moderate sigma; generate 20 samples.
      const baseLog10 = Math.log10(3e-4);
      const samples: number[] = [];
      for (let i = 0; i < 20; i++) {
        // Box-Muller
        const u1 = Math.max(1e-9, rnd());
        const u2 = rnd();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const log10Pc = baseLog10 + z * 0.5 + (rnd() - 0.5) * 0.25;
        samples.push(log10Pc);
      }
      samples.sort((a, b) => a - b);
      const q = (p: number): number => {
        const idx = Math.min(samples.length - 1, Math.max(0, Math.floor(p * samples.length)));
        return samples[idx]!;
      };
      const median = samples[Math.floor(samples.length / 2)]!;
      const p5Log = q(0.05);
      const p95Log = q(0.95);
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
      const sigmaLog = Math.sqrt(variance);

      // histogram: 8 bins over [min, max]
      const lo = samples[0]!;
      const hi = samples[samples.length - 1]!;
      const binWidth = (hi - lo) / 8 || 1e-6;
      const histogramBins: Array<{ log10Pc: number; count: number }> = [];
      for (let b = 0; b < 8; b++) {
        const edgeLo = lo + b * binWidth;
        const edgeHi = edgeLo + binWidth;
        const count = samples.filter((s) =>
          b === 7 ? s >= edgeLo && s <= edgeHi : s >= edgeLo && s < edgeHi,
        ).length;
        histogramBins.push({ log10Pc: Number((edgeLo + binWidth / 2).toFixed(3)), count });
      }

      // clusters — split by tight/nominal/loose covariance flag, deterministic
      const clusters: PcCluster[] = [
        {
          mode: "nominal-covariance",
          flags: ["hbr=20m", "cov=nominal"],
          pcRange: [Math.pow(10, q(0.25)), Math.pow(10, q(0.75))],
          fishCount: 12,
        },
        {
          mode: "loose-covariance",
          flags: ["hbr=30m", "cov=loose", "low-data"],
          pcRange: [Math.pow(10, q(0.75)), Math.pow(10, q(0.95))],
          fishCount: 5,
        },
        {
          mode: "tight-covariance",
          flags: ["hbr=10m", "cov=tight"],
          pcRange: [Math.pow(10, q(0.05)), Math.pow(10, q(0.25))],
          fishCount: 3,
        },
      ];

      const medianPc = Math.pow(10, median);
      const severity: PcEstimate["severity"] =
        medianPc >= 1e-3 ? "high" : medianPc >= 1e-4 ? "medium" : "info";

      return {
        kind: "pc",
        conjunctionId: step.conjunctionId,
        estimate: {
          medianPc: Number(medianPc.toExponential(3)),
          sigmaPc: Number(sigmaLog.toFixed(4)),
          p5Pc: Number(Math.pow(10, p5Log).toExponential(3)),
          p95Pc: Number(Math.pow(10, p95Log).toExponential(3)),
          fishCount: samples.length,
          histogramBins,
          clusters,
          severity,
          suggestionId: `PC-${step.conjunctionId.replace(/[^a-z0-9]/gi, "").toUpperCase()}`,
        },
      };
    },

    async explain(step: Extract<Step, { action: "explain" }>): Promise<DispatchResult> {
      const f = fx.findings.find((x) => x.id === step.findingId) ?? fx.findings[0]!;
      // Deterministic sha256-like stub (16 hex chars; renderer trims to 8).
      const sha = (key: string): string => {
        let h = hashSeed(key);
        let hex = "";
        for (let i = 0; i < 4; i++) {
          h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
          hex += h.toString(16).padStart(8, "0");
        }
        return hex.slice(0, 16);
      };
      // Build a 3-level tree: finding → edges (linked entities) → source_items → raw evidence refs.
      const priority = (sc: "field" | "osint" | "sim" | "derived"): number =>
        sc === "field" ? 0 : sc === "osint" ? 1 : sc === "sim" ? 2 : 3;
      // Map fixture evidence.kind (osint|field|derived) to source_class buckets used in the UI.
      const evidences = f.evidence.map((ev, i) => {
        const sc: "field" | "osint" | "sim" | "derived" =
          ev.kind === "field" ? "field" : ev.kind === "osint" ? "osint" : "sim";
        return { ...ev, sc, seq: i };
      });
      // Each linked entity becomes an edge; each edge gets a deterministic sha256 chip
      // and a child source_item, which in turn holds a leaf evidence ref.
      const edges: WhyNode[] = f.linkedEntityIds.slice(0, 4).map((ent, idx) => {
        // Pair this edge with an evidence by round-robin, so each level surfaces a real ref.
        const ev = evidences.length > 0 ? evidences[idx % evidences.length]! : null;
        const sc: "field" | "osint" | "sim" = ev?.sc ?? "sim";
        const edgeKey = `${f.id}|edge|${ent}|${idx}`;
        const sourceItems: WhyNode[] = ev
          ? [{
              id: `si:${f.id}:${idx}`,
              label: ev.uri,
              kind: "source_item",
              sourceClass: sc,
              sha256: sha(`${edgeKey}|si`),
              detail: ev.snippet,
              children: [{
                id: `ev:${f.id}:${idx}`,
                label: `evidence:${ev.uri}`,
                kind: "evidence",
                sourceClass: sc,
                detail: ev.snippet,
                children: [],
              }],
            }]
          : [];
        return {
          id: `e:${f.id}:${idx}`,
          label: `linked: ${ent}`,
          kind: "edge",
          sourceClass: sc,
          sha256: sha(edgeKey),
          detail: `cortex:${f.cortex}`,
          children: sourceItems,
        };
      });
      // Sort children at each level by sourceClass priority (FIELD > OSINT > SIM).
      const sortByClass = (arr: WhyNode[]): WhyNode[] =>
        arr
          .map((n) => ({ ...n, children: sortByClass(n.children) }))
          .sort((a, b) => priority(a.sourceClass ?? "derived") - priority(b.sourceClass ?? "derived"));
      const sortedEdges = sortByClass(edges);
      const tree: WhyNode = {
        id: f.id,
        label: `${f.id} · ${f.title}`,
        kind: "finding",
        detail: f.cortex,
        children: sortedEdges,
      };
      // Stats: count edges + source_items across the tree and tally source_classes.
      const stats: WhyStats = { edges: 0, sourceItems: 0, byClass: { field: 0, osint: 0, sim: 0 } };
      const tally = (n: WhyNode): void => {
        if (n.kind === "edge") stats.edges++;
        if (n.kind === "source_item") stats.sourceItems++;
        if (n.sourceClass && n.sourceClass !== "derived" && n.kind !== "finding") {
          stats.byClass[n.sourceClass]++;
        }
        n.children.forEach(tally);
      };
      tree.children.forEach(tally);
      return { kind: "why", findingId: f.id, tree, stats };
    },
  };
}

function buildBriefingUiActions(query: string): BriefingUiAction[] {
  const low = query.toLowerCase();
  const uiActions: BriefingUiAction[] = [
    {
      kind: "open_feed",
      target: "autonomy",
      label: "Open autonomy FEED",
    },
  ];
  const wantsConfig = /\b(config|configure|runtime|setting|settings)\b/.test(low);
  const wantsAutonomy =
    /\b(autonomy|loop|interval|rotation|tick|spend|cap)\b/.test(low);
  const wantsBudgets =
    /\b(budget|budgets|cost|complexity|simple|moderate|deep)\b/.test(low);

  if (wantsConfig || wantsAutonomy) {
    uiActions.push({
      kind: "open_config",
      domain: "console.autonomy",
      label: "Tune console.autonomy",
    });
  }
  if (wantsConfig || wantsBudgets) {
    uiActions.push({
      kind: "open_config",
      domain: "thalamus.budgets",
      label: "Review thalamus.budgets",
    });
  }
  return uiActions;
}

export async function runTurn(
  input: string,
  fx: Fixtures,
  sessionId: string,
): Promise<{ results: DispatchResult[]; costUsd: number; tookMs: number }> {
  const t0 = Date.now();
  const plan = parseExplicitCommand(input) ?? heuristicRoute(input);
  const adapters = makeAdapters(fx);
  const baseSeed = hashSeed(`${sessionId}:${input}`);
  const results: DispatchResult[] = [];
  let costUsd = 0;
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    const seed = baseSeed + i;
    let r: DispatchResult;
    switch (step.action) {
      case "query": r = await adapters.query(step, seed); break;
      case "telemetry": r = await adapters.telemetry(step, seed); break;
      case "logs": r = await adapters.logs(step, seed); break;
      case "graph": r = await adapters.graph(step, seed); break;
      case "accept": r = await adapters.accept(step); break;
      case "explain": r = await adapters.explain(step); break;
      case "pc": r = await adapters.pc(step, seed); break;
      case "clarify": r = { kind: "clarify", question: step.question, options: step.options }; break;
    }
    if (r.kind === "briefing") costUsd += r.costUsd;
    else costUsd += 0.002 + (seed % 100) / 10000;
    results.push(r);
  }
  return { results, costUsd: Number(costUsd.toFixed(4)), tookMs: Date.now() - t0 };
}

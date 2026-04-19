/** Mirrors apps/console-api/src/fixtures.ts DTOs. Keep in sync. */

export type Regime = "LEO" | "MEO" | "GEO" | "HEO";
export type SourceClass = "osint" | "field" | "derived";
export type FindingStatus = "pending" | "accepted" | "rejected" | "in-review";
export type EntityClass =
  | "Satellite"
  | "Debris"
  | "Operator"
  | "Payload"
  | "OrbitRegime"
  | "ConjunctionEvent"
  | "Maneuver";

export type SatelliteDTO = {
  id: number;
  name: string;
  noradId: number;
  regime: Regime;
  operator: string;
  country: string;
  inclinationDeg: number;
  semiMajorAxisKm: number;
  eccentricity: number;
  raanDeg: number;
  argPerigeeDeg: number;
  meanAnomalyDeg: number;
  meanMotionRevPerDay: number;
  epoch: string;
  massKg: number;
  classificationTier: "unclassified" | "sensitive" | "restricted";
  /** OpacityScout — [0..1] information-deficit score. Null when not computed. */
  opacityScore?: number | null;
  /**
   * OpacityScout — ordered list of deficit labels (`"payload undisclosed"`,
   * `"amateur-only corroboration (SeeSat-L)"`, `"catalog dropout 2026-03-12"`).
   * Drawer renders them as-is. UI never shows `"classified"`.
   */
  opacityDeficitReasons?: string[];
  /** TLE line 1 (when ingested from CelesTrak). Enables SGP4 propagation. */
  tleLine1?: string | null;
  /** TLE line 2 (when ingested from CelesTrak). Enables SGP4 propagation. */
  tleLine2?: string | null;
};

export type ConjunctionDTO = {
  id: number;
  primaryId: number;
  secondaryId: number;
  primaryName: string;
  secondaryName: string;
  regime: Regime;
  epoch: string;
  minRangeKm: number;
  relativeVelocityKmps: number;
  probabilityOfCollision: number;
  combinedSigmaKm: number;
  hardBodyRadiusM: number;
  pcMethod: string;
  computedAt: string;
  covarianceQuality: "HIGH" | "MED" | "LOW";
  action: "maneuver_candidate" | "monitor" | "no_action";
};

export type KgNodeDTO = {
  id: string;
  label: string;
  class: EntityClass;
  degree: number;
  x: number;
  y: number;
  cortex: string;
};

export type KgEdgeDTO = {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: number;
  sourceClass: SourceClass;
};

export type FindingDTO = {
  id: string;
  title: string;
  summary: string;
  cortex: string;
  status: FindingStatus;
  priority: number;
  createdAt: string;
  linkedEntityIds: string[];
  evidence: { kind: SourceClass; uri: string; snippet: string }[];
  swarmConsensus?: { accept: number; reject: number; abstain: number; k: number };
  decisionReason?: string;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  satellites: (regime?: Regime) =>
    getJson<{ items: SatelliteDTO[]; count: number }>(
      `/api/satellites${regime ? `?regime=${regime}` : ""}`,
    ),
  conjunctions: (minPc = 0) =>
    getJson<{ items: ConjunctionDTO[]; count: number }>(`/api/conjunctions?minPc=${minPc}`),
  kgNodes: () => getJson<{ items: KgNodeDTO[] }>(`/api/kg/nodes`),
  kgEdges: () => getJson<{ items: KgEdgeDTO[] }>(`/api/kg/edges`),
  findings: (params?: { status?: FindingStatus; cortex?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.cortex) qs.set("cortex", params.cortex);
    return getJson<{ items: FindingDTO[]; count: number }>(
      `/api/findings${qs.toString() ? `?${qs}` : ""}`,
    );
  },
  finding: (id: string) => getJson<FindingDTO>(`/api/findings/${encodeURIComponent(id)}`),
  decision: async (id: string, decision: FindingStatus, reason?: string) => {
    const res = await fetch(`/api/findings/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { ok: boolean; finding: FindingDTO };
  },
  stats: () =>
    getJson<{
      satellites: number;
      conjunctions: number;
      kgNodes: number;
      kgEdges: number;
      findings: number;
      byStatus: Record<string, number>;
      byCortex: Record<string, number>;
    }>(`/api/stats`),
  runCycle: async (kind: "thalamus" | "fish" | "both") => {
    const res = await fetch(`/api/cycles/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { cycle: CycleDTO };
  },
  cycles: () => getJson<{ items: CycleDTO[] }>(`/api/cycles`),
  sweepSuggestions: () =>
    getJson<{ items: SweepSuggestionDTO[]; count: number }>(`/api/sweep/suggestions`),
  missionStatus: () => getJson<MissionStateDTO>(`/api/sweep/mission/status`),
  missionStart: async () => {
    const res = await fetch(`/api/sweep/mission/start`, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { ok: boolean; state: MissionStateDTO };
  },
  missionStop: async () => {
    const res = await fetch(`/api/sweep/mission/stop`, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { ok: boolean; state: MissionStateDTO };
  },
  autonomyStatus: () => getJson<AutonomyStateDTO>(`/api/autonomy/status`),
  autonomyStart: async (intervalSec?: number) => {
    const res = await fetch(`/api/autonomy/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intervalSec }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { ok: boolean; state: AutonomyStateDTO };
  },
  autonomyStop: async () => {
    const res = await fetch(`/api/autonomy/stop`, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { ok: boolean; state: AutonomyStateDTO };
  },
  reviewSuggestion: async (id: string, accept: boolean, reason?: string) => {
    const res = await fetch(`/api/sweep/suggestions/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept, reason }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as {
      ok: boolean;
      reviewed: boolean;
      resolution: { status: string; affectedRows: number; errors?: string[] } | null;
    };
  },
};

export type SweepSuggestionDTO = {
  id: string;
  title: string;
  description: string;
  suggestedAction: string;
  category: string;
  severity: "info" | "warning" | "critical";
  operatorCountryName: string;
  affectedSatellites: number;
  createdAt: string;
  accepted: boolean | null;
  resolutionStatus: string | null;
  hasPayload: boolean;
};

export type MissionTaskDTO = {
  suggestionId: string;
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

export type MissionStateDTO = {
  running: boolean;
  startedAt: string | null;
  total: number;
  completed: number;
  filled: number;
  unobtainable: number;
  errors: number;
  cursor: number;
  currentTask: MissionTaskDTO | null;
  recent: MissionTaskDTO[];
};

export type AutonomyTickDTO = {
  id: string;
  action: "thalamus" | "sweep-nullscan" | "fish-swarm";
  queryOrMode: string;
  startedAt: string;
  completedAt: string;
  emitted: number;
  error?: string;
};

export type AutonomyStateDTO = {
  running: boolean;
  intervalMs: number;
  startedAt: string | null;
  tickCount: number;
  currentTick: AutonomyTickDTO | null;
  history: AutonomyTickDTO[];
  nextTickInMs: number | null;
};

export type CycleDTO = {
  id: string;
  kind: "thalamus" | "fish" | "both";
  startedAt: string;
  completedAt: string;
  findingsEmitted: number;
  cortices: string[];
};

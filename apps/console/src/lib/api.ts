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
};

export type ConjunctionDTO = {
  id: number;
  primaryId: number;
  secondaryId: number;
  primaryName: string;
  secondaryName: string;
  epoch: string;
  minRangeKm: number;
  relativeVelocityKmps: number;
  probabilityOfCollision: number;
  combinedSigmaKm: number;
  hardBodyRadiusM: number;
  pcMethod: string;
  sourceClass: SourceClass;
  corroborated: boolean;
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
    getJson<{ items: SatelliteDTO[]; total: number }>(
      `/api/satellites${regime ? `?regime=${regime}` : ""}`,
    ),
  conjunctions: (minPc = 0) =>
    getJson<{ items: ConjunctionDTO[]; total: number }>(`/api/conjunctions?minPc=${minPc}`),
  kgNodes: () => getJson<{ items: KgNodeDTO[] }>(`/api/kg/nodes`),
  kgEdges: () => getJson<{ items: KgEdgeDTO[] }>(`/api/kg/edges`),
  findings: (params?: { status?: FindingStatus; cortex?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.cortex) qs.set("cortex", params.cortex);
    return getJson<{ items: FindingDTO[]; total: number }>(
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
};

export type CycleDTO = {
  id: string;
  kind: "thalamus" | "fish" | "both";
  startedAt: string;
  completedAt: string;
  findingsEmitted: number;
  cortices: string[];
};

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
  opacityScore?: number | null;
  opacityDeficitReasons?: string[];
  tleLine1?: string | null;
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
  costUsd: number;
  error?: string;
};

export type AutonomyStateDTO = {
  running: boolean;
  intervalMs: number;
  startedAt: string | null;
  tickCount: number;
  currentTick: AutonomyTickDTO | null;
  history: AutonomyTickDTO[];
  dailySpendUsd: number;
  monthlySpendUsd: number;
  thalamusCyclesToday: number;
  stoppedReason:
    | null
    | "daily_budget_exhausted"
    | "monthly_budget_exhausted"
    | "max_thalamus_cycles_per_day"
    | "stopped_by_operator";
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

export type StatsDTO = {
  satellites: number;
  conjunctions: number;
  kgNodes: number;
  kgEdges: number;
  findings: number;
  byStatus: Record<string, number>;
  byCortex: Record<string, number>;
};

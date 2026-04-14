/**
 * Satellite Reference Pipeline Types (SSA)
 * @module types/satellite-reference
 *
 * Pure types for the satellite reference creation pipeline and operator-country
 * correction system. Used by: service, repository, controller, transformer, jobs, agent.
 */

// ============================================================================
// Enrichment Input / Output
// ============================================================================

/** Raw satellite data from ingestion/import, before enrichment */
export interface RawSatelliteInput {
  name: string;
  platformClass?: string;
  operatorCountry?: string;
  launchYear?: string;
  operator?: string;
  /** Original row indices from the source file (dedup tracking) */
  rowIndices: number[];
}

/** LLM enrichment output (validated by Zod schema in service) */
export interface EnrichmentOutput {
  name: string;
  operatorCountry: string;
  orbitRegime: string;
  platformClass: string;
  launchYear: string;
  operator: string;
  payloads: Array<{
    name: string;
    role?: "primary" | "secondary" | "auxiliary";
  }>;
  classification?: string;
  isSecondary?: boolean;
  parentSatellite?: string;
  confidence: number;
}

// ============================================================================
// Pending Reference (Phase 1 output → Phase 2 review → Phase 3 commit)
// ============================================================================

/** A pending satellite reference awaiting review before DB insertion */
export interface PendingReference {
  id: string;
  raw: RawSatelliteInput;
  enriched: EnrichmentOutput;
  resolved: ResolvedFKs;
  busMatch: BusMatchResult | null;
  embeddings: {
    search: number[] | null;
    desc: number[] | null;
  };
  confidence: number;
  provider: "kimi" | "openai" | "none";
  flags: string[];
}

/** Resolved foreign keys for a satellite reference */
export interface ResolvedFKs {
  operatorCountryId: bigint | null;
  orbitRegimeId: bigint | null;
  platformClassId: bigint | null;
  operatorId: bigint | null;
  payloads: ResolvedPayload[];
  flags: string[];
}

/** A payload with resolved DB ID and doctrine data */
export interface ResolvedPayload {
  name: string;
  payloadId: bigint;
  role?: string;
  massKg?: number;
  powerW?: number;
}

// ============================================================================
// SatelliteBus Matching
// ============================================================================

export interface BusMatchResult {
  satelliteBusId: bigint;
  satelliteBusName: string;
  strategy: "doctrine-matrix" | "db-frequency" | "embedding";
  confidence: number;
  telemetrySummary14d: TelemetryScalars | null;
}

/** 14D telemetry profile scalars (power, thermal, pointing, comms signature) */
export interface TelemetryScalars {
  powerDraw: number;
  thermalMargin: number;
  pointingAccuracy: number;
  attitudeRate: number;
  linkBudget: number;
  dataRate: number;
  payloadDuty: number;
  eclipseRatio: number;
  solarArrayHealth: number;
  batteryDepthOfDischarge: number;
  propellantRemaining: number;
  radiationDose: number;
  debrisProximity: number;
  missionAge: number;
}

// ============================================================================
// OperatorCountry Correction
// ============================================================================

export interface OperatorCountryCorrection {
  id: string;
  satelliteId: bigint;
  satelliteName: string;
  currentOperatorCountry: string | null;
  suggestedOperatorCountry: string;
  suggestedOperatorCountryId: bigint;
  confidence: number;
  reason: string;
  strategy: "hierarchy" | "generic" | "null" | "llm";
}

// ============================================================================
// AI Assistant
// ============================================================================

export interface SatelliteContext {
  name: string;
  operatorCountry?: string;
  platformClass?: string;
  launchYear?: string;
  operator?: string;
  payloads?: string[];
}

export interface AssistResponse {
  answer: string;
  sources: string[];
  suggestedChanges?: Partial<EnrichmentOutput>;
}

export interface ISatelliteAssistant {
  assist(
    satelliteContext: SatelliteContext,
    question: string,
  ): Promise<AssistResponse>;
}

// ============================================================================
// BullMQ Job Payloads
// ============================================================================

export interface EnrichSatellitesJobData {
  satellites: RawSatelliteInput[];
  sessionId: string;
}

export interface ScanOperatorCountriesJobData {
  sessionId: string;
  issueTypes?: Array<"hierarchy" | "generic" | "null" | "doctrine-payloads">;
}

export interface InsertSatellitesJobData {
  sessionId: string;
  approvedIds: string[];
}

export interface ApplyCorrectionsJobData {
  sessionId: string;
  approvedIds: string[];
}

export interface JobProgress {
  step: string;
  completed: number;
  total: number;
  message: string;
}

// ============================================================================
// Pipeline Result
// ============================================================================

export interface PipelineResult {
  sessionId: string;
  pending: PendingReference[];
  corrections: OperatorCountryCorrection[];
  stats: {
    totalInput: number;
    deduplicated: number;
    enriched: number;
    resolved: number;
    busMatched: number;
    flagged: number;
  };
}

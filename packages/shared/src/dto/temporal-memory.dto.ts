export type TemporalPatternStatusDto =
  | "candidate"
  | "reviewable"
  | "accepted"
  | "rejected"
  | "deprecated";

export type TemporalSourceDomainDto =
  | "production"
  | "simulation"
  | "simulation_seeded"
  | "mixed";

export interface TemporalPatternStepDto {
  stepIndex: number;
  eventSignature: string;
  avgDeltaMs: number;
  supportCount: number;
}

export interface TemporalPatternExampleDto {
  eventId: string;
  role: "positive" | "negative" | "counterexample";
  entityId?: string | null;
  simRunId?: string | null;
  fishIndex?: number | null;
  turnIndex?: number | null;
  embeddingId?: string | null;
  occurredAt: string;
}

export interface TemporalPatternScoreComponentsDto {
  temporalWeight: number;
  supportFactor: number;
  liftFactor: number;
  negativePenalty: number;
  stabilityFactor: number;
}

export interface TemporalPatternMemoryDto {
  patternId: string;
  patternHash: string;
  status: TemporalPatternStatusDto;
  sourceDomain: TemporalSourceDomainDto;
  terminalStatus: string;
  patternScore: number;
  supportCount: number;
  negativeSupportCount: number;
  baselineRate?: number | null;
  lift?: number | null;
  patternWindowMs: number;
  patternVersion: string;
  sequence: TemporalPatternStepDto[];
  examples: TemporalPatternExampleDto[];
  counterexamples: TemporalPatternExampleDto[];
  scoreComponents: TemporalPatternScoreComponentsDto;
  hypothesis: true;
  decisionAuthority: false;
}

export interface TemporalPatternQueryDto {
  terminalStatus?: string;
  sourceDomain?: TemporalSourceDomainDto;
  includeAuditOnly?: boolean;
  limit?: number;
  cursor?: string;
}

export interface TemporalPatternQueryResultDto {
  patterns: TemporalPatternMemoryDto[];
  nextCursor: string | null;
}

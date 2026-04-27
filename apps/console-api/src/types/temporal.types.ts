import type {
  TemporalPatternExample,
  TemporalLearningStatus,
  TemporalPatternHypothesis,
  TemporalPatternStep,
  TemporalPatternStatus,
  TemporalProjectionStatus,
  TemporalSourceDomain,
} from "@interview/db-schema";
import type {
  STDPParams,
  TemporalPatternHypothesis as CoreTemporalPatternHypothesis,
} from "@interview/temporal";

export interface TemporalProjectionRunRow {
  id: bigint;
  projectionVersion: string;
  sourceScope: string;
  fromTs: Date;
  toTs: Date;
  inputSnapshotHash: string;
  status: TemporalProjectionStatus;
  metricsJson: Record<string, unknown>;
  createdAt: Date;
  completedAt: Date | null;
}

export interface CreateTemporalProjectionRunInput {
  projectionVersion: string;
  sourceScope: string;
  fromTs: Date;
  toTs: Date;
  inputSnapshotHash: string;
  status?: TemporalProjectionStatus;
}

export interface InsertTemporalEventInput {
  id: string;
  projectionRunId: bigint;
  eventType: string;
  eventSource: string;
  entityId?: string | null;
  simRunId?: bigint | null;
  fishIndex?: number | null;
  turnIndex?: number | null;
  occurredAt: Date;
  agentId?: string | null;
  actionKind?: string | null;
  confidenceBefore?: number | null;
  confidenceAfter?: number | null;
  reviewOutcome?: string | null;
  terminalStatus?: string | null;
  embeddingId?: string | null;
  seededByPatternId?: string | null;
  sourceDomain: TemporalSourceDomain;
  canonicalSignature: string;
  sourceTable: string;
  sourcePk: string;
  payloadHash: string;
  metadataJson?: Record<string, unknown>;
}

export interface TemporalEventRow extends InsertTemporalEventInput {
  createdAt: Date;
}

export interface ListTemporalEventsForLearningInput {
  from: Date;
  to: Date;
  sourceDomain: Exclude<TemporalSourceDomain, "mixed">;
}

export interface CreateTemporalLearningRunInput {
  patternVersion: string;
  sourceDomain: Exclude<TemporalSourceDomain, "mixed">;
  inputSnapshotHash: string;
  paramsJson: Record<string, unknown>;
  status?: TemporalLearningStatus;
}

export interface TemporalLearningRunRow {
  id: bigint;
  patternVersion: string;
  sourceDomain: TemporalSourceDomain;
  inputSnapshotHash: string;
  paramsJson: Record<string, unknown>;
  status: TemporalLearningStatus;
  metricsJson: Record<string, unknown>;
  startedAt: Date;
  completedAt: Date | null;
}

export interface PersistTemporalPatternsInput {
  learningRunId: bigint;
  patterns: CoreTemporalPatternHypothesis[];
  eventsById: Map<string, TemporalEventRow>;
}

export interface PersistedTemporalPatternRow {
  id: bigint;
  patternHash: string;
  patternVersion: string;
  status: TemporalPatternStatus;
}

export interface ListTemporalPatternsForMemoryInput {
  statuses: TemporalPatternStatus[];
  terminalStatus?: string;
  sourceDomain?: TemporalSourceDomain;
  limit: number;
}

export interface TemporalPatternMemoryRepositoryRow {
  hypothesis: TemporalPatternHypothesis;
  steps: TemporalPatternStep[];
  examples: TemporalPatternExample[];
}

export interface RunTemporalLearningInput {
  from: Date;
  to: Date;
  sourceDomain: TemporalSourceDomain;
  params: STDPParams;
  targetOutcomes?: string[];
}

export interface TemporalLearningSummary {
  learningRunId: bigint;
  sourceDomain: Exclude<TemporalSourceDomain, "mixed">;
  inputSnapshotHash: string;
  eventCount: number;
  patternCount: number;
  persistedPatternCount: number;
}

export type TemporalPatternHypothesisRow = TemporalPatternHypothesis;

export type SimKindDto =
  | "uc1_operator_behavior"
  | "uc3_conjunction"
  | "uc_telemetry_inference"
  | "uc_pc_estimator";

export type SimRunStatusDto =
  | "pending"
  | "running"
  | "paused"
  | "done"
  | "failed"
  | "timeout";
export type SimSwarmStatusDto = "pending" | "running" | "done" | "failed";
export type MemoryKindDto = "self_action" | "observation" | "belief";
export type TurnActorKindDto = "agent" | "god" | "system";

export interface SwarmConfigDto {
  llmMode: "cloud" | "fixtures" | "record";
  quorumPct: number;
  perFishTimeoutMs: number;
  fishConcurrency: number;
  nanoModel: string;
  seed: number;
}

export interface SimConfigDto {
  turnsPerDay: number;
  maxTurns: number;
  llmMode: "cloud" | "fixtures" | "record";
  seed: number;
  nanoModel: string;
  perFishTimeoutMs?: number;
}

export type SeedRefsDto = Record<string, unknown>;
export type PerturbationSpecDto = Record<string, unknown> & { kind: string };

export interface CreateRunDto {
  simRunId: string;
}

export interface CreateSwarmDto {
  swarmId: string;
}

export interface CreateAgentDto {
  agentId: string;
}

export interface IdCountDto {
  count: number;
}

export type EmptyDto = Record<string, never>;

export interface SimRunDto {
  id?: string;
  swarmId: string;
  fishIndex?: number;
  kind: SimKindDto;
  status: SimRunStatusDto;
  seedApplied?: SeedRefsDto;
  perturbation?: PerturbationSpecDto;
  config: SimConfigDto;
  startedAt?: string;
  completedAt?: string | null;
}

export interface SimAgentDto {
  id: string;
  agentIndex: number;
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
}

export interface SimSwarmDto {
  id: string;
  kind: SimKindDto | string;
  title: string;
  size: number;
  status: SimSwarmStatusDto;
  baseSeed: SeedRefsDto;
  config: SwarmConfigDto | Record<string, unknown>;
  outcomeReportFindingId: string | null;
  suggestionId: string | null;
  startedAt?: string;
  completedAt?: string | null;
}

export interface SwarmFishCountsDto {
  done: number;
  failed: number;
  timeout: number;
  running: number;
  pending: number;
  paused: number;
}

export interface ClaimedSwarmFishDto {
  simRunId: string;
  fishIndex: number;
}

export interface SimTurnInsertDto {
  simTurnId: string;
}

export interface PersistTurnBatchDto {
  simTurnIds: string[];
}

export interface GodEventDto {
  turnIndex: number;
  observableSummary: string;
  action: Record<string, unknown>;
}

export interface LastTurnAtDto {
  at: string | null;
}

export interface SimMemoryRowDto {
  id: string;
  turnIndex: number;
  kind: MemoryKindDto;
  content: string;
  score?: number;
}

export interface MemoryBatchWriteDto {
  ids: string[];
}

export interface ObservableTurnDto {
  turnIndex: number;
  actorKind: TurnActorKindDto;
  agentId: string | null;
  observableSummary: string;
}

export interface SimFishTerminalDto {
  simRunId: string;
  fishIndex: number;
  runStatus: SimRunStatusDto;
  agentIndex: number | null;
  action: Record<string, unknown> | null;
  observableSummary: string | null;
  turnsPlayed: number;
}

export interface SimFishTerminalActionDto {
  simRunId: string;
  fishIndex: number;
  runStatus: SimRunStatusDto;
  action: Record<string, unknown> | null;
}

export interface SwarmStatusDto {
  swarmId: string;
  kind: string;
  status: SimSwarmStatusDto | string;
  size: number;
  done: number;
  failed: number;
  timeout: number;
  running: number;
  pending: number;
  reportFindingId: string | null;
  suggestionId: string | null;
}

export interface LaunchSwarmDto {
  swarmId: string;
  fishCount: number;
  firstSimRunId: string;
}

export interface LaunchPcDto extends LaunchSwarmDto {
  conjunctionId: string;
}

export interface StartStandaloneDto {
  swarmId: string;
  simRunId: string;
  agentIds: string[];
}

export interface OperatorSwarmSummaryDto {
  id: string;
  kind: string;
  title: string;
  size: number;
  status: SimSwarmStatusDto | string;
  counts: SwarmFishCountsDto;
  aggregateKeys: string[];
  outcomeReportFindingId: string | null;
  suggestionId: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface OperatorSwarmListDto {
  swarms: OperatorSwarmSummaryDto[];
  nextCursor: string | null;
}

export interface OperatorSwarmStatusDto extends SwarmStatusDto {
  aggregateKeys: string[];
}

export interface FishTimelineAgentDto {
  id: string;
  operatorId: string | null;
  agentIndex: number;
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
}

export interface FishTimelineTurnDto {
  id: string;
  turnIndex: number;
  actorKind: TurnActorKindDto;
  agentId: string | null;
  agentIndex: number | null;
  action: Record<string, unknown>;
  rationale: string;
  observableSummary: string;
  llmCostUsd: number | null;
  createdAt: string;
}

export interface FishTimelineDto {
  swarmId: string;
  simRunId: string;
  fishIndex: number;
  kind: string;
  status: SimRunStatusDto | string;
  seedApplied: SeedRefsDto;
  perturbation: PerturbationSpecDto;
  config: SimConfigDto | Record<string, unknown>;
  agents: FishTimelineAgentDto[];
  turns: FishTimelineTurnDto[];
  totalLlmCostUsd: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface SwarmClusterDto {
  label?: string;
  fraction?: number;
  memberFishIndexes?: number[];
  exemplarFishIndex?: number | null;
  exemplarSimRunId?: string | null;
  [key: string]: unknown;
}

export interface PcAggregateClusterDto {
  label: string;
  memberFishIndexes: number[];
  exemplarFishIndex: number;
  exemplarSimRunId: string | null;
  fishCount: number;
  pcRange: [number, number];
  mode: string;
  flags: string[];
  [key: string]: unknown;
}

export interface PcAggregateSummaryDto {
  conjunctionId?: number;
  medianPc?: number;
  sigmaPc?: number;
  p5Pc?: number;
  p95Pc?: number;
  fishCount?: number;
  samples?: number[];
  severity?: "high" | "medium" | "info";
  quorumMet?: boolean;
  succeededFish?: number;
  failedFish?: number;
  [key: string]: unknown;
}

export type SwarmClustersDto =
  | {
      swarmId: string;
      source: "pcAggregate";
      clusters: PcAggregateClusterDto[];
      summary: PcAggregateSummaryDto;
    }
  | {
      swarmId: string;
      source: "aggregate" | "telemetryAggregate" | null;
      clusters: SwarmClusterDto[];
      summary: Record<string, unknown>;
    };

export interface FishTraceDto extends FishTimelineDto {
  exportedAt: string;
}

export type SimReviewScopeDto = "swarm" | "fish" | "cluster";

export interface SimReviewEvidenceDto {
  id: string;
  swarmId: string;
  simRunId: string | null;
  scope: SimReviewScopeDto;
  question: string;
  answer: string;
  evidenceRefs: Array<Record<string, unknown>>;
  traceExcerpt: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

export interface AskSimReviewQuestionDto {
  evidence: SimReviewEvidenceDto;
  provider: string;
}

import type { ActorKind, MemoryKind, TurnAction } from "@interview/db-schema";

export interface SimTurnRow {
  id: bigint;
  simRunId: bigint;
  turnIndex: number;
  actorKind: ActorKind;
  agentId: bigint | null;
  action: TurnAction;
  rationale: string;
  observableSummary: string;
  llmCostUsd: number | null;
  createdAt: Date;
}

export interface SimGodEventRow {
  turnIndex: number;
  observableSummary: string;
  action: TurnAction;
}

export interface InsertAgentTurnInput {
  simRunId: bigint;
  turnIndex: number;
  agentId: bigint;
  action: TurnAction;
  rationale: string;
  observableSummary: string;
  llmCostUsd?: number | null;
}

export interface InsertGodTurnInput {
  simRunId: bigint;
  turnIndex: number;
  action: TurnAction;
  rationale: string;
  observableSummary: string;
}

export interface SimMemoryBatchRow {
  simRunId: bigint;
  agentId: bigint;
  turnIndex: number;
  kind: MemoryKind;
  content: string;
  embedding: number[] | null;
}

export interface PersistTurnBatchInput {
  agentTurns: InsertAgentTurnInput[];
  memoryRows: SimMemoryBatchRow[];
}

export interface RecentObservableRow {
  turnIndex: number;
  actorKind: ActorKind;
  agentId: bigint | null;
  observableSummary: string;
}

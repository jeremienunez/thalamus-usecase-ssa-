import type {
  MemoryKind,
  PerturbationSpec,
  SeedRefs,
  SimConfig,
  SimKind,
  SimRunStatus,
  SwarmConfig,
  TurnAction,
} from "../types";

export interface SimRuntimeRun {
  swarmId: number;
  kind: SimKind;
  status: SimRunStatus;
  config: SimConfig;
}

export interface SimRuntimeSwarmWrite {
  kind: SimKind;
  title: string;
  baseSeed: SeedRefs;
  perturbations: PerturbationSpec[];
  size: number;
  config: SwarmConfig;
  status?: "pending" | "running" | "done" | "failed";
  createdBy?: number | null;
}

export interface SimRuntimeRunWrite {
  swarmId: number;
  fishIndex: number;
  kind: SimKind;
  seedApplied: SeedRefs;
  perturbation: PerturbationSpec;
  config: SimConfig;
  status?: SimRunStatus;
}

export interface SimRuntimeAgent {
  id: number;
  agentIndex: number;
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
}

export interface SimRuntimeGodEvent {
  turnIndex: number;
  observableSummary: string;
  detail?: string;
}

export interface SimRuntimeObservableTurn {
  turnIndex: number;
  actorKind: "agent" | "god" | "system";
  agentId: number | null;
  observableSummary: string;
}

export interface SimRuntimeMemoryRow {
  id: number;
  turnIndex: number;
  kind: MemoryKind;
  content: string;
  score?: number;
}

export interface SimRuntimeTurnWrite {
  simRunId: number;
  turnIndex: number;
  agentId: number;
  action: TurnAction;
  rationale: string;
  observableSummary: string;
  llmCostUsd?: number | null;
}

export interface SimRuntimeAgentWrite {
  simRunId: number;
  subjectId: number | null;
  agentIndex: number;
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
}

export interface SimRuntimeMemoryWrite {
  simRunId: number;
  agentId: number;
  turnIndex: number;
  kind: MemoryKind;
  content: string;
  embedding?: number[] | null;
}

export interface SimRuntimeStore {
  insertSwarm(input: SimRuntimeSwarmWrite): Promise<number>;
  insertRun(input: SimRuntimeRunWrite): Promise<number>;
  insertAgent(input: SimRuntimeAgentWrite): Promise<number>;
  getRun(simRunId: number): Promise<SimRuntimeRun | null>;
  listAgents(simRunId: number): Promise<SimRuntimeAgent[]>;
  insertGodTurn(input: {
    simRunId: number;
    turnIndex: number;
    action: TurnAction;
    rationale: string;
    observableSummary: string;
  }): Promise<number>;
  listGodEventsAtOrBefore(
    simRunId: number,
    turnIndex: number,
    limit?: number,
  ): Promise<SimRuntimeGodEvent[]>;
  persistTurnBatch(input: {
    agentTurns: SimRuntimeTurnWrite[];
    memoryRows: SimRuntimeMemoryWrite[];
  }): Promise<number[]>;
  writeMemoryBatch(rows: SimRuntimeMemoryWrite[]): Promise<number[]>;
  updateRunStatus(
    simRunId: number,
    status: SimRunStatus,
    completedAt?: Date | null,
  ): Promise<void>;
  countAgentTurnsForRun(simRunId: number): Promise<number>;
  lastTurnCreatedAt(simRunId: number): Promise<Date | null>;
  recentObservable(opts: {
    simRunId: number;
    sinceTurnIndex: number;
    excludeAgentId?: number;
    limit: number;
  }): Promise<SimRuntimeObservableTurn[]>;
  topKByVector(opts: {
    simRunId: number;
    agentId: number;
    vec: number[];
    k: number;
  }): Promise<SimRuntimeMemoryRow[]>;
  topKByRecency(opts: {
    simRunId: number;
    agentId: number;
    k: number;
  }): Promise<SimRuntimeMemoryRow[]>;
}

export type {
  SimKind,
  SimSwarmStatus,
  SimRunStatus,
  ActorKind,
  MemoryKind,
  SeedRefs,
  SwarmConfig,
  SimConfig,
  PerturbationSpec,
  TurnAction,
  SimSwarm,
  SimRun,
  SimAgent,
  SimTurn,
  SimAgentMemory,
  NewSimSwarm,
  NewSimRun,
  NewSimAgent,
  NewSimTurn,
  NewSimAgentMemory,
} from "@interview/db-schema";

import type { TurnAction } from "@interview/db-schema";
import type { SimSubjectSnapshot } from "./ports/subject.port";

export interface TurnResponse {
  action: TurnAction;
  rationale: string;
  observableSummary: string;
}

export interface FishSeed {
  simRunId: number;
  swarmId: number;
  fishIndex: number;
  subjectIds: number[];
  horizonDays: number;
  turnsPerDay: number;
  queuedEvents: Array<{
    kind: string;
    summary: string;
    detail?: string;
    targets?: Record<string, unknown>;
  }>;
}

export interface AgentContext {
  simRunId: number;
  agentId: number;
  agentIndex: number;
  turnIndex: number;
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
  topMemories: Array<{
    turnIndex: number;
    kind: string;
    content: string;
  }>;
  observable: Array<{
    turnIndex: number;
    actorKind: string;
    authorLabel: string;
    observableSummary: string;
  }>;
  godEvents: Array<{
    turnIndex: number;
    summary: string;
    detail?: string;
  }>;
  subjectSnapshot: SimSubjectSnapshot | null;
  scenarioContext: Record<string, unknown> | null;
}

export interface FishOutcome {
  simRunId: number;
  fishIndex: number;
  terminalAction: TurnAction | null;
  terminalObservableSummary: string;
  terminalEmbedding: number[] | null;
  turnsPlayed: number;
  costUsd: number;
  status: "done" | "failed" | "timeout";
  failureReason?: string;
}

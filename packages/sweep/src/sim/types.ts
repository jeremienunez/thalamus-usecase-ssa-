/**
 * Sim engine types — re-export the canonical shapes declared in
 * @interview/db-schema/sim.ts + add orchestration-layer types that
 * don't warrant a DB column.
 */

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

/**
 * Full per-turn response produced by the sim_operator_agent cortex.
 * `rationale` is private to the author agent; `observableSummary` is what
 * other agents receive next turn.
 */
export interface TurnResponse {
  action: TurnAction;
  rationale: string;
  observableSummary: string;
}

/** Per-fish seed after a PerturbationSpec has been applied to the base seed. */
export interface FishSeed {
  simRunId: number;
  swarmId: number;
  fishIndex: number;
  operatorIds: number[];
  horizonDays: number;
  turnsPerDay: number;
  conjunctionFindingId?: number;
  // Carried forward for UC1 god-event-first injection at turn 0.
  preInjectedGodEvents: Array<{
    kind: string;
    summary: string;
    detail?: string;
    targetSatelliteId?: number;
    targetOperatorId?: number;
  }>;
}

/** Turn-time context assembled from DB by MemoryService.buildContext. */
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
    authorLabel: string; // operator name, or "GOD", or "SYSTEM"
    observableSummary: string;
  }>;
  godEvents: Array<{
    turnIndex: number;
    summary: string;
    detail?: string;
  }>;
  fleetSnapshot: FleetSnapshot | null;
}

/** Compact fleet summary passed into each turn prompt. Cached per fish. */
export interface FleetSnapshot {
  operatorName: string;
  operatorCountry: string | null;
  satelliteCount: number;
  regimeMix: Array<{ regime: string; count: number }>;
  platformMix: Array<{ platform: string; count: number }>;
  avgLaunchYear: number | null;
}

/** Output of one fish — used by the aggregator. */
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

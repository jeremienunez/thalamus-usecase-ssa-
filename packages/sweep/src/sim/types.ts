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
  /**
   * Populated on telemetry-inference fish (sim_swarm.kind === "uc_telemetry_inference").
   * Carries the target satellite + flattened bus datasheet prior that grounds
   * the infer_telemetry action. Absent for UC1 / UC3 operator-behaviour swarms.
   */
  telemetryTarget: TelemetryTarget | null;
  /**
   * Populated on Pc-estimator fish (sim_swarm.kind === "uc_pc_estimator").
   * Carries the conjunction event + both satellites + the per-fish perturbation
   * (hard-body radius × covariance scale) that disambiguates each sample.
   * Absent for telemetry / UC1 / UC3 swarms.
   */
  pcEstimatorTarget: PcEstimatorTarget | null;
}

export type PcEstimatorTarget = import("./load-pc-target").PcEstimatorTarget;

/** Satellite + bus-datasheet prior, injected as a dedicated prompt block. */
export interface TelemetryTarget {
  satelliteId: number;
  satelliteName: string;
  noradId: number | null;
  regime: string | null;
  launchYear: number | null;
  busArchetype: string | null;
  /**
   * Flattened prior: `{ [scalarKey]: { typical, min, max, unit } }`.
   * Null when no datasheet matched the bus name — the fish must say so
   * rather than invent values.
   */
  busDatasheetPrior: Record<
    string,
    { typical: number; min: number; max: number; unit: string }
  > | null;
  /** Citation URLs for the bus datasheet (reviewer audit). */
  sources: string[];
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

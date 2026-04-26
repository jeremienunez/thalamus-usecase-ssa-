import type {
  SeedRefs,
  SimKind,
  SimRunStatus,
  SimSwarmStatus,
  SwarmConfig,
  TurnAction,
} from "../types";

export interface SimSwarmRecord {
  id: number;
  kind: SimKind;
  title: string;
  baseSeed: SeedRefs;
  size: number;
  config: SwarmConfig;
  status: SimSwarmStatus;
  outcomeReportFindingId: number | null;
  suggestionId: number | null;
}

export interface SimSwarmFishCounts {
  done: number;
  failed: number;
  timeout: number;
  running: number;
  pending: number;
  paused: number;
}

export interface SimSwarmPendingFish {
  simRunId: number;
  fishIndex: number;
}

export interface SimSwarmTerminalRow {
  simRunId: number;
  fishIndex: number;
  runStatus: SimRunStatus;
  agentIndex: number | null;
  action: TurnAction | null;
  observableSummary: string | null;
  turnsPlayed: number;
}

export interface SimSwarmTerminalActionRow {
  simRunId: number;
  fishIndex: number;
  runStatus: SimRunStatus;
  action: TurnAction | null;
}

export interface SimSwarmStore {
  getSwarm(swarmId: number): Promise<SimSwarmRecord | null>;
  countFishByStatus(swarmId: number): Promise<SimSwarmFishCounts>;
  claimPendingFishForSwarm(
    swarmId: number,
    limit: number,
  ): Promise<SimSwarmPendingFish[]>;
  abortSwarm(swarmId: number): Promise<void>;
  listTerminalsForSwarm(swarmId: number): Promise<SimSwarmTerminalRow[]>;
  listTerminalActionsForSwarm(
    swarmId: number,
  ): Promise<SimSwarmTerminalActionRow[]>;
  snapshotAggregate(input: {
    swarmId: number;
    key: string;
    value: Record<string, unknown>;
  }): Promise<void>;
  closeSwarm(input: {
    swarmId: number;
    status: "done" | "failed";
    suggestionId?: number | null;
    reportFindingId?: number | null;
    completedAt?: Date;
  }): Promise<void>;
}

import type { SimRunStatus, TurnAction } from "@interview/db-schema";

export interface SimFishTerminalRow {
  simRunId: bigint;
  fishIndex: number;
  runStatus: SimRunStatus;
  agentIndex: number | null;
  action: TurnAction | null;
  observableSummary: string | null;
  turnsPlayed: number;
}

export interface SimFishTerminalActionRow {
  simRunId: bigint;
  fishIndex: number;
  runStatus: SimRunStatus;
  action: TurnAction | null;
}

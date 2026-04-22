export interface SimRunExecutionStatusDto {
  swarmId: string;
  simRunId: string;
  status: string;
  turnsPlayed: number;
  maxTurns: number;
  lastTurnAt: string | null;
}

export interface SimScheduleNextDto {
  scheduled: boolean;
  reason?: string;
}

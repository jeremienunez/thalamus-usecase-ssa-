import type { SimStatus } from "@interview/sweep";

export interface ScheduleNextResultLike {
  scheduled: boolean;
  reason?: string;
}

export interface SimRunStatusDto {
  swarmId: string;
  simRunId: string;
  status: string;
  turnsPlayed: number;
  maxTurns: number;
  lastTurnAt: string | null;
}

export function toSimRunStatusDto(v: SimStatus): SimRunStatusDto {
  return {
    swarmId: v.swarmId.toString(),
    simRunId: v.simRunId.toString(),
    status: v.status,
    turnsPlayed: v.turnsPlayed,
    maxTurns: v.maxTurns,
    lastTurnAt: v.lastTurnAt ? v.lastTurnAt.toISOString() : null,
  };
}

export interface ScheduleNextDto {
  scheduled: boolean;
  reason?: string;
}

export function toScheduleNextDto(r: ScheduleNextResultLike): ScheduleNextDto {
  return r.reason === undefined
    ? { scheduled: r.scheduled }
    : { scheduled: r.scheduled, reason: r.reason };
}

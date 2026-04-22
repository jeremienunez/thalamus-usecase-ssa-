import type {
  SimRunExecutionStatusDto,
  SimScheduleNextDto,
} from "@interview/shared/dto/sim-orchestrator.dto";
import type { SimStatus } from "@interview/sweep";

export interface ScheduleNextResultLike {
  scheduled: boolean;
  reason?: string;
}

export function toSimRunExecutionStatusDto(
  v: SimStatus,
): SimRunExecutionStatusDto {
  return {
    swarmId: v.swarmId.toString(),
    simRunId: v.simRunId.toString(),
    status: v.status,
    turnsPlayed: v.turnsPlayed,
    maxTurns: v.maxTurns,
    lastTurnAt: v.lastTurnAt ? v.lastTurnAt.toISOString() : null,
  };
}

export function toSimScheduleNextDto(
  r: ScheduleNextResultLike,
): SimScheduleNextDto {
  return r.reason === undefined
    ? { scheduled: r.scheduled }
    : { scheduled: r.scheduled, reason: r.reason };
}

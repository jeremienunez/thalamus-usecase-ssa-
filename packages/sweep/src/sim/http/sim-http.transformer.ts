import type {
  GodEventDto,
  ObservableTurnDto,
  SimAgentDto,
  SimFishTerminalActionDto,
  SimFishTerminalDto,
  SimMemoryRowDto,
  SimRunDto,
  SimSwarmDto,
} from "@interview/shared/dto/sim-http.dto";
import type {
  SimRuntimeAgent,
  SimRuntimeGodEvent,
  SimRuntimeMemoryRow,
  SimRuntimeObservableTurn,
  SimRuntimeRun,
} from "../ports/runtime-store.port";
import type {
  SimSwarmRecord,
  SimSwarmTerminalActionRow,
  SimSwarmTerminalRow,
} from "../ports/swarm-store.port";
import type { TurnAction } from "../types";

export function parseDtoId(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a safe integer, got "${value}"`);
  }
  return parsed;
}

export function parseOptionalDtoDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

export function fromSimRunDto(dto: SimRunDto): SimRuntimeRun {
  return {
    swarmId: parseDtoId(dto.swarmId, "swarmId"),
    kind: dto.kind,
    status: dto.status,
    config: dto.config,
  };
}

export function fromSimAgentDto(dto: SimAgentDto): SimRuntimeAgent {
  return {
    id: parseDtoId(dto.id, "agentId"),
    agentIndex: dto.agentIndex,
    persona: dto.persona,
    goals: dto.goals,
    constraints: dto.constraints,
  };
}

export function fromGodEventDto(dto: GodEventDto): SimRuntimeGodEvent {
  return {
    turnIndex: dto.turnIndex,
    observableSummary: dto.observableSummary,
    detail: typeof dto.action?.detail === "string" ? dto.action.detail : undefined,
  };
}

export function fromObservableTurnDto(
  dto: ObservableTurnDto,
): SimRuntimeObservableTurn {
  return {
    turnIndex: dto.turnIndex,
    actorKind: dto.actorKind,
    agentId: dto.agentId === null ? null : parseDtoId(dto.agentId, "agentId"),
    observableSummary: dto.observableSummary,
  };
}

export function fromSimMemoryRowDto(dto: SimMemoryRowDto): SimRuntimeMemoryRow {
  return {
    id: parseDtoId(dto.id, "memoryId"),
    turnIndex: dto.turnIndex,
    kind: dto.kind,
    content: dto.content,
    score: dto.score,
  };
}

export function fromSimSwarmDto(dto: SimSwarmDto): SimSwarmRecord {
  return {
    id: parseDtoId(dto.id, "swarmId"),
    kind: dto.kind as SimSwarmRecord["kind"],
    title: dto.title,
    baseSeed: dto.baseSeed as SimSwarmRecord["baseSeed"],
    size: dto.size,
    config: dto.config as SimSwarmRecord["config"],
    status: dto.status,
    outcomeReportFindingId:
      dto.outcomeReportFindingId === null
        ? null
        : parseDtoId(dto.outcomeReportFindingId, "reportFindingId"),
    suggestionId:
      dto.suggestionId === null
        ? null
        : parseDtoId(dto.suggestionId, "suggestionId"),
  };
}

export function fromSimFishTerminalDto(
  dto: SimFishTerminalDto,
): SimSwarmTerminalRow {
  return {
    simRunId: parseDtoId(dto.simRunId, "simRunId"),
    fishIndex: dto.fishIndex,
    runStatus: dto.runStatus,
    agentIndex: dto.agentIndex,
    action: dto.action as TurnAction | null,
    observableSummary: dto.observableSummary,
    turnsPlayed: dto.turnsPlayed,
  };
}

export function fromSimFishTerminalActionDto(
  dto: SimFishTerminalActionDto,
): SimSwarmTerminalActionRow {
  return {
    simRunId: parseDtoId(dto.simRunId, "simRunId"),
    fishIndex: dto.fishIndex,
    runStatus: dto.runStatus,
    action: dto.action as TurnAction | null,
  };
}

import type {
  CreateAgentDto,
  CreateRunDto,
  CreateSwarmDto,
  EmptyDto,
  GodEventDto,
  IdCountDto,
  LastTurnAtDto,
  LaunchPcDto,
  LaunchSwarmDto,
  MemoryBatchWriteDto,
  ObservableTurnDto,
  PersistTurnBatchDto,
  PerturbationSpecDto,
  SeedRefsDto,
  SimAgentDto,
  SimConfigDto,
  SimFishTerminalActionDto,
  SimFishTerminalDto,
  SimKindDto,
  SimMemoryRowDto,
  SimRunDto,
  SimSwarmDto,
  SimTurnInsertDto,
  StartStandaloneDto,
  SwarmConfigDto,
  SwarmFishCountsDto,
  SwarmStatusDto,
} from "@interview/shared/dto/sim-http.dto";
import type {
  LaunchSwarmResult,
  StartStandaloneResult,
  SwarmService,
} from "@interview/sweep";
import type { SimRunRow, SimSwarmFishCounts } from "../types/sim-run.types";
import type { SimSwarmRow } from "../types/sim-swarm.types";
import type {
  RecentObservableRow,
  SimGodEventRow,
} from "../types/sim-turn.types";
import type { SimAgentRow } from "../types/sim-agent.types";
import type { SimMemoryRow } from "../types/sim-memory.types";
import type {
  SimFishTerminalActionRow,
  SimFishTerminalRow,
} from "../types/sim-terminal.types";

type SwarmStatus = NonNullable<Awaited<ReturnType<SwarmService["status"]>>>;

export function toEmptyDto(): EmptyDto {
  return {};
}

export function toCreateRunDto(simRunId: bigint): CreateRunDto {
  return { simRunId: simRunId.toString() };
}

export function toCreateSwarmDto(swarmId: bigint): CreateSwarmDto {
  return { swarmId: swarmId.toString() };
}

export function toCreateAgentDto(agentId: bigint): CreateAgentDto {
  return { agentId: agentId.toString() };
}

export function toCountDto(count: number): IdCountDto {
  return { count };
}

export function toSeedRefsDto(seed: Record<string, unknown>): SeedRefsDto {
  return { ...seed };
}

export function toSimRunDto(run: SimRunRow): SimRunDto {
  return {
    id: run.id.toString(),
    swarmId: run.swarmId.toString(),
    fishIndex: run.fishIndex,
    kind: run.kind as SimKindDto,
    status: run.status,
    seedApplied: toSeedRefsDto(run.seedApplied as Record<string, unknown>),
    perturbation: run.perturbation as PerturbationSpecDto,
    config: run.config,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
  };
}

export function toSimAgentDto(agent: SimAgentRow): SimAgentDto {
  return {
    id: agent.id.toString(),
    agentIndex: agent.agentIndex,
    persona: agent.persona,
    goals: agent.goals,
    constraints: agent.constraints,
  };
}

export function toSimSwarmDto(swarm: SimSwarmRow): SimSwarmDto {
  return {
    id: swarm.id.toString(),
    kind: swarm.kind,
    title: swarm.title,
    size: swarm.size,
    status: swarm.status,
    baseSeed: toSeedRefsDto(swarm.baseSeed as Record<string, unknown>),
    config: swarm.config,
    outcomeReportFindingId: swarm.outcomeReportFindingId?.toString() ?? null,
    suggestionId: swarm.suggestionId?.toString() ?? null,
    startedAt: swarm.startedAt.toISOString(),
    completedAt: swarm.completedAt ? swarm.completedAt.toISOString() : null,
  };
}

export function toSwarmFishCountsDto(
  counts: SimSwarmFishCounts,
): SwarmFishCountsDto {
  return {
    done: counts.done,
    failed: counts.failed,
    running: counts.running,
    pending: counts.pending,
    paused: counts.paused,
  };
}

export function toInsertTurnDto(simTurnId: bigint): SimTurnInsertDto {
  return { simTurnId: simTurnId.toString() };
}

export function toPersistTurnBatchDto(ids: bigint[]): PersistTurnBatchDto {
  return { simTurnIds: ids.map(String) };
}

export function toGodEventDto(row: SimGodEventRow): GodEventDto {
  return {
    turnIndex: row.turnIndex,
    observableSummary: row.observableSummary,
    action: row.action as unknown as Record<string, unknown>,
  };
}

export function toLastTurnAtDto(at: Date | null): LastTurnAtDto {
  return { at: at ? at.toISOString() : null };
}

export function toSimMemoryRowDto(row: SimMemoryRow): SimMemoryRowDto {
  return {
    id: row.id.toString(),
    turnIndex: row.turnIndex,
    kind: row.kind,
    content: row.content,
    ...(row.score === undefined ? {} : { score: row.score }),
  };
}

export function toMemoryBatchWriteDto(ids: bigint[]): MemoryBatchWriteDto {
  return { ids: ids.map(String) };
}

export function toObservableTurnDto(row: RecentObservableRow): ObservableTurnDto {
  return {
    turnIndex: row.turnIndex,
    actorKind: row.actorKind,
    agentId: row.agentId?.toString() ?? null,
    observableSummary: row.observableSummary,
  };
}

export function toSimFishTerminalDto(row: SimFishTerminalRow): SimFishTerminalDto {
  return {
    simRunId: row.simRunId.toString(),
    fishIndex: row.fishIndex,
    runStatus: row.runStatus,
    agentIndex: row.agentIndex,
    action: row.action as Record<string, unknown> | null,
    observableSummary: row.observableSummary,
    turnsPlayed: row.turnsPlayed,
  };
}

export function toSimFishTerminalActionDto(
  row: SimFishTerminalActionRow,
): SimFishTerminalActionDto {
  return {
    simRunId: row.simRunId.toString(),
    runStatus: row.runStatus,
    action: row.action as Record<string, unknown> | null,
  };
}

export function toSwarmStatusDto(status: SwarmStatus): SwarmStatusDto {
  return {
    swarmId: String(status.swarmId),
    kind: status.kind,
    status: status.status,
    size: status.size,
    done: status.done,
    failed: status.failed,
    running: status.running,
    pending: status.pending,
    reportFindingId: status.reportFindingId === null ? null : String(status.reportFindingId),
    suggestionId: status.suggestionId === null ? null : String(status.suggestionId),
  };
}

export function toLaunchSwarmDto(result: LaunchSwarmResult): LaunchSwarmDto {
  return {
    swarmId: String(result.swarmId),
    fishCount: result.fishCount,
    firstSimRunId: String(result.firstSimRunId),
  };
}

export function toLaunchPcDto(
  result: LaunchSwarmResult & { conjunctionId: number },
): LaunchPcDto {
  return {
    ...toLaunchSwarmDto(result),
    conjunctionId: String(result.conjunctionId),
  };
}

export function toStartStandaloneDto(
  result: StartStandaloneResult,
): StartStandaloneDto {
  return {
    swarmId: String(result.swarmId),
    simRunId: String(result.simRunId),
    agentIds: result.agentIds.map(String),
  };
}

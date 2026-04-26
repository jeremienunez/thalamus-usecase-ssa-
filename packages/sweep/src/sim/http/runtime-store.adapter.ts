import type { SimRuntimeStore } from "../ports/runtime-store.port";
import type {
  CreateAgentDto,
  CreateRunDto,
  CreateSwarmDto,
  GodEventDto,
  IdCountDto,
  LastTurnAtDto,
  MemoryBatchWriteDto,
  ObservableTurnDto,
  PersistTurnBatchDto,
  SimAgentDto,
  SimMemoryRowDto,
  SimRunDto,
  SimTurnInsertDto,
} from "@interview/shared/dto/sim-http.dto";
import { SimHttpClient } from "./client";
import {
  fromGodEventDto,
  fromObservableTurnDto,
  fromSimAgentDto,
  fromSimMemoryRowDto,
  fromSimRunDto,
  parseDtoId,
  parseOptionalDtoDate,
} from "./sim-http.transformer";

export class SimRuntimeStoreHttpAdapter implements SimRuntimeStore {
  constructor(private readonly http: SimHttpClient) {}

  async insertSwarm(input: Parameters<SimRuntimeStore["insertSwarm"]>[0]) {
    const dto = await this.http.post<CreateSwarmDto>("/api/sim/swarms", {
      kind: input.kind,
      title: input.title,
      baseSeed: toSeedRefsBody(input.baseSeed),
      perturbations: input.perturbations,
      size: input.size,
      config: input.config,
      ...(input.createdBy === undefined || input.createdBy === null
        ? {}
        : { createdBy: String(input.createdBy) }),
    });
    return parseDtoId(dto.swarmId, "swarmId");
  }

  async insertRun(input: Parameters<SimRuntimeStore["insertRun"]>[0]) {
    const dto = await this.http.post<CreateRunDto>("/api/sim/runs", {
      swarmId: String(input.swarmId),
      fishIndex: input.fishIndex,
      kind: input.kind,
      seedApplied: toSeedRefsBody(input.seedApplied),
      perturbation: input.perturbation,
      config: input.config,
    });
    return parseDtoId(dto.simRunId, "simRunId");
  }

  async insertAgent(input: Parameters<SimRuntimeStore["insertAgent"]>[0]) {
    const dto = await this.http.post<CreateAgentDto>(
      `/api/sim/runs/${input.simRunId}/agents`,
      {
        ...(input.subjectId === null
          ? { subjectId: null }
          : { subjectId: String(input.subjectId) }),
        agentIndex: input.agentIndex,
        persona: input.persona,
        goals: input.goals,
        constraints: input.constraints,
      },
    );
    return parseDtoId(dto.agentId, "agentId");
  }

  async getRun(simRunId: number) {
    const dto = await this.http.get<SimRunDto>(`/api/sim/runs/${simRunId}`);
    return fromSimRunDto(dto);
  }

  async listAgents(simRunId: number) {
    const rows = await this.http.get<SimAgentDto[]>(`/api/sim/runs/${simRunId}/agents`);
    return rows.map(fromSimAgentDto);
  }

  async insertGodTurn(input: Parameters<SimRuntimeStore["insertGodTurn"]>[0]) {
    const dto = await this.http.post<SimTurnInsertDto>(
      `/api/sim/runs/${input.simRunId}/god-turns`,
      {
        turnIndex: input.turnIndex,
        action: input.action,
        rationale: input.rationale,
        observableSummary: input.observableSummary,
      },
    );
    return parseDtoId(dto.simTurnId, "simTurnId");
  }

  async listGodEventsAtOrBefore(
    simRunId: number,
    turnIndex: number,
    limit: number = 10,
  ) {
    const rows = await this.http.get<GodEventDto[]>(
      `/api/sim/runs/${simRunId}/god-events`,
      {
        query: { beforeTurn: turnIndex, limit },
      },
    );
    return rows.map(fromGodEventDto);
  }

  async persistTurnBatch(input: Parameters<SimRuntimeStore["persistTurnBatch"]>[0]) {
    const simRunId = input.agentTurns[0]?.simRunId ?? input.memoryRows[0]?.simRunId;
    if (simRunId === undefined) return [];

    const dto = await this.http.post<PersistTurnBatchDto>(
      `/api/sim/runs/${simRunId}/turns/batch`,
      {
        agentTurns: input.agentTurns.map((turn) => ({
          turnIndex: turn.turnIndex,
          agentId: String(turn.agentId),
          action: turn.action,
          rationale: turn.rationale,
          observableSummary: turn.observableSummary,
          llmCostUsd: turn.llmCostUsd ?? null,
        })),
        memoryRows: input.memoryRows.map((row) => ({
          agentId: String(row.agentId),
          turnIndex: row.turnIndex,
          kind: row.kind,
          content: row.content,
          embedding: row.embedding ?? null,
        })),
      },
    );
    return dto.simTurnIds.map((id) => parseDtoId(id, "simTurnId"));
  }

  async writeMemoryBatch(rows: Parameters<SimRuntimeStore["writeMemoryBatch"]>[0]) {
    if (rows.length === 0) return [];
    const simRunId = rows[0]!.simRunId;
    const dto = await this.http.post<MemoryBatchWriteDto>(
      `/api/sim/runs/${simRunId}/memory/batch`,
      rows.map((row) => ({
        agentId: String(row.agentId),
        turnIndex: row.turnIndex,
        kind: row.kind,
        content: row.content,
        embedding: row.embedding ?? null,
      })),
    );
    return dto.ids.map((id) => parseDtoId(id, "memoryId"));
  }

  async updateRunStatus(
    simRunId: number,
    status: Parameters<SimRuntimeStore["updateRunStatus"]>[1],
    completedAt?: Date | null,
  ) {
    await this.http.patch(`/api/sim/runs/${simRunId}/status`, {
      status,
      ...(completedAt === undefined
        ? {}
        : { completedAt: completedAt === null ? null : completedAt.toISOString() }),
    });
  }

  async countAgentTurnsForRun(simRunId: number) {
    const dto = await this.http.get<IdCountDto>(
      `/api/sim/runs/${simRunId}/agent-turn-count`,
    );
    return dto.count;
  }

  async lastTurnCreatedAt(simRunId: number) {
    const dto = await this.http.get<LastTurnAtDto>(
      `/api/sim/runs/${simRunId}/last-turn-at`,
    );
    return parseOptionalDtoDate(dto.at);
  }

  async recentObservable(
    opts: Parameters<SimRuntimeStore["recentObservable"]>[0],
  ) {
    const rows = await this.http.get<ObservableTurnDto[]>(
      `/api/sim/runs/${opts.simRunId}/observable`,
      {
        query: {
          sinceTurn: opts.sinceTurnIndex,
          limit: opts.limit,
          ...(opts.excludeAgentId === undefined
            ? {}
            : { excludeAgentId: String(opts.excludeAgentId) }),
        },
      },
    );
    return rows.map(fromObservableTurnDto);
  }

  async topKByVector(
    opts: Parameters<SimRuntimeStore["topKByVector"]>[0],
  ) {
    const rows = await this.http.post<SimMemoryRowDto[]>(
      `/api/sim/runs/${opts.simRunId}/memory/search`,
      {
        agentId: String(opts.agentId),
        vec: opts.vec,
        k: opts.k,
      },
    );
    return rows.map(fromSimMemoryRowDto);
  }

  async topKByRecency(
    opts: Parameters<SimRuntimeStore["topKByRecency"]>[0],
  ) {
    const rows = await this.http.get<SimMemoryRowDto[]>(
      `/api/sim/runs/${opts.simRunId}/memory/recent`,
      {
        query: {
          agentId: String(opts.agentId),
          k: opts.k,
        },
      },
    );
    return rows.map(fromSimMemoryRowDto);
  }
}

function toSeedRefsBody(
  seed: Parameters<SimRuntimeStore["insertSwarm"]>[0]["baseSeed"],
) {
  return { ...(seed as Record<string, unknown>) };
}

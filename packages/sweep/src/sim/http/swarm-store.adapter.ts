import type { SimSwarmStore } from "../ports/swarm-store.port";
import type { TurnAction } from "../types";
import { SimHttpClient } from "./client";

interface SimSwarmDto {
  id: string;
  kind: Parameters<SimSwarmStore["getSwarm"]>[0] extends never ? never : string;
  title: string;
  size: number;
  status: "pending" | "running" | "done" | "failed";
  baseSeed: Record<string, unknown>;
  config: Record<string, unknown>;
  outcomeReportFindingId: string | null;
  suggestionId: string | null;
}

interface SwarmFishCountsDto {
  done: number;
  failed: number;
  running: number;
  pending: number;
  paused: number;
}

interface SimFishTerminalDto {
  simRunId: string;
  fishIndex: number;
  runStatus: "pending" | "running" | "paused" | "done" | "failed";
  agentIndex: number | null;
  action: Record<string, unknown> | null;
  observableSummary: string | null;
  turnsPlayed: number;
}

interface SimFishTerminalActionDto {
  simRunId: string;
  runStatus: "pending" | "running" | "paused" | "done" | "failed";
  action: Record<string, unknown> | null;
}

function toNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a safe integer, got "${value}"`);
  }
  return parsed;
}

export class SimSwarmStoreHttpAdapter implements SimSwarmStore {
  constructor(private readonly http: SimHttpClient) {}

  async getSwarm(swarmId: number) {
    const dto = await this.http.get<SimSwarmDto>(`/api/sim/swarms/${swarmId}`);
    return {
      id: toNumber(dto.id, "swarmId"),
      kind: dto.kind as Awaited<ReturnType<SimSwarmStore["getSwarm"]>> extends infer T
        ? T extends { kind: infer K }
          ? K
          : never
        : never,
      title: dto.title,
      baseSeed: dto.baseSeed as Awaited<
        ReturnType<SimSwarmStore["getSwarm"]>
      > extends infer T
        ? T extends { baseSeed: infer S }
          ? S
          : never
        : never,
      size: dto.size,
      config: dto.config as never,
      status: dto.status,
      outcomeReportFindingId:
        dto.outcomeReportFindingId === null
          ? null
          : toNumber(dto.outcomeReportFindingId, "reportFindingId"),
      suggestionId:
        dto.suggestionId === null
          ? null
          : toNumber(dto.suggestionId, "suggestionId"),
    };
  }

  countFishByStatus(swarmId: number) {
    return this.http.get<SwarmFishCountsDto>(`/api/sim/swarms/${swarmId}/fish-counts`);
  }

  async abortSwarm(swarmId: number) {
    await this.http.post(`/api/sim/swarms/${swarmId}/abort`);
  }

  async listTerminalsForSwarm(swarmId: number) {
    const rows = await this.http.get<SimFishTerminalDto[]>(
      `/api/sim/swarms/${swarmId}/terminals`,
    );
    return rows.map((row) => ({
      simRunId: toNumber(row.simRunId, "simRunId"),
      fishIndex: row.fishIndex,
      runStatus: row.runStatus,
      agentIndex: row.agentIndex,
      action: row.action as TurnAction | null,
      observableSummary: row.observableSummary,
      turnsPlayed: row.turnsPlayed,
    }));
  }

  async listTerminalActionsForSwarm(swarmId: number) {
    const rows = await this.http.get<SimFishTerminalActionDto[]>(
      `/api/sim/swarms/${swarmId}/terminal-actions`,
    );
    return rows.map((row) => ({
      simRunId: toNumber(row.simRunId, "simRunId"),
      runStatus: row.runStatus,
      action: row.action as TurnAction | null,
    }));
  }

  async snapshotAggregate(
    input: Parameters<SimSwarmStore["snapshotAggregate"]>[0],
  ) {
    await this.http.patch(`/api/sim/swarms/${input.swarmId}/aggregate`, {
      key: input.key,
      value: input.value,
    });
  }

  async closeSwarm(input: Parameters<SimSwarmStore["closeSwarm"]>[0]) {
    await this.http.post(`/api/sim/swarms/${input.swarmId}/close`, {
      status: input.status,
      ...(input.suggestionId === undefined
        ? {}
        : { suggestionId: input.suggestionId === null ? null : String(input.suggestionId) }),
      ...(input.reportFindingId === undefined
        ? {}
        : {
            reportFindingId:
              input.reportFindingId === null ? null : String(input.reportFindingId),
          }),
      ...(input.completedAt === undefined
        ? {}
        : { completedAt: input.completedAt.toISOString() }),
    });
  }
}

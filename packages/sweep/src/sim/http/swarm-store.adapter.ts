import type { SimSwarmStore } from "../ports/swarm-store.port";
import type { TurnAction } from "../types";
import type {
  SimFishTerminalActionDto,
  SimFishTerminalDto,
  SimSwarmDto,
  SwarmFishCountsDto,
} from "@interview/shared/dto/sim-http.dto";
import { SimHttpClient } from "./client";
import {
  fromSimFishTerminalActionDto,
  fromSimFishTerminalDto,
  fromSimSwarmDto,
} from "./sim-http.transformer";

export class SimSwarmStoreHttpAdapter implements SimSwarmStore {
  constructor(private readonly http: SimHttpClient) {}

  async getSwarm(swarmId: number) {
    const dto = await this.http.get<SimSwarmDto>(`/api/sim/swarms/${swarmId}`);
    return fromSimSwarmDto(dto);
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
    return rows.map(fromSimFishTerminalDto);
  }

  async listTerminalActionsForSwarm(swarmId: number) {
    const rows = await this.http.get<SimFishTerminalActionDto[]>(
      `/api/sim/swarms/${swarmId}/terminal-actions`,
    );
    return rows.map(fromSimFishTerminalActionDto);
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

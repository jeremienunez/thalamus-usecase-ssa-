import type { SimSwarmStore } from "@interview/sweep";
import type { SimSwarmFishCounts } from "../types/sim-run.types";
import type {
  CloseSimSwarmInput,
  SimSwarmRow,
  SnapshotAggregateInput,
} from "../types/sim-swarm.types";
import type {
  SimFishTerminalActionRow,
  SimFishTerminalRow,
} from "../types/sim-terminal.types";

export interface SimSwarmStoreSwarmPort {
  abortSwarm(swarmId: bigint): Promise<void>;
  closeSwarm(input: CloseSimSwarmInput): Promise<void>;
  findById(swarmId: bigint): Promise<SimSwarmRow | null>;
  snapshotAggregate(input: SnapshotAggregateInput): Promise<void>;
}

export interface SimSwarmStoreRunPort {
  countFishByStatus(swarmId: bigint): Promise<SimSwarmFishCounts>;
  claimPendingFishForSwarm(
    swarmId: bigint,
    limit: number,
  ): Promise<Array<{ simRunId: bigint; fishIndex: number }>>;
}

export interface SimSwarmStoreTerminalPort {
  listTerminalsForSwarm(swarmId: bigint): Promise<SimFishTerminalRow[]>;
  listTerminalActionsForSwarm(
    swarmId: bigint,
  ): Promise<SimFishTerminalActionRow[]>;
}

export class SimSwarmStoreService implements SimSwarmStore {
  constructor(
    private readonly swarmRepo: SimSwarmStoreSwarmPort,
    private readonly runRepo: SimSwarmStoreRunPort,
    private readonly terminalRepo: SimSwarmStoreTerminalPort,
  ) {}

  async getSwarm(swarmId: number) {
    const row = await this.swarmRepo.findById(BigInt(swarmId));
    if (!row) return null;
    return {
      id: Number(row.id),
      kind: row.kind,
      title: row.title,
      baseSeed: row.baseSeed,
      size: row.size,
      config: row.config,
      status: row.status,
      outcomeReportFindingId:
        row.outcomeReportFindingId === null
          ? null
          : Number(row.outcomeReportFindingId),
      suggestionId:
        row.suggestionId === null ? null : Number(row.suggestionId),
    };
  }

  countFishByStatus(swarmId: number) {
    return this.runRepo.countFishByStatus(BigInt(swarmId));
  }

  async claimPendingFishForSwarm(swarmId: number, limit: number) {
    const rows = await this.runRepo.claimPendingFishForSwarm(
      BigInt(swarmId),
      limit,
    );
    return rows.map((row) => ({
      simRunId: Number(row.simRunId),
      fishIndex: row.fishIndex,
    }));
  }

  async abortSwarm(swarmId: number): Promise<void> {
    await this.swarmRepo.abortSwarm(BigInt(swarmId));
  }

  async listTerminalsForSwarm(swarmId: number) {
    const rows = await this.terminalRepo.listTerminalsForSwarm(BigInt(swarmId));
    return rows.map((row) => ({
      simRunId: Number(row.simRunId),
      fishIndex: row.fishIndex,
      runStatus: row.runStatus,
      agentIndex: row.agentIndex,
      action: row.action,
      observableSummary: row.observableSummary,
      turnsPlayed: row.turnsPlayed,
    }));
  }

  async listTerminalActionsForSwarm(swarmId: number) {
    const rows = await this.terminalRepo.listTerminalActionsForSwarm(
      BigInt(swarmId),
    );
    return rows.map((row) => ({
      simRunId: Number(row.simRunId),
      fishIndex: row.fishIndex,
      runStatus: row.runStatus,
      action: row.action,
    }));
  }

  async snapshotAggregate(input: {
    swarmId: number;
    key: string;
    value: Record<string, unknown>;
  }): Promise<void> {
    await this.swarmRepo.snapshotAggregate({
      swarmId: BigInt(input.swarmId),
      key: input.key,
      value: input.value,
    });
  }

  async closeSwarm(input: {
    swarmId: number;
    status: "done" | "failed";
    suggestionId?: number | null;
    reportFindingId?: number | null;
    completedAt?: Date;
  }): Promise<void> {
    await this.swarmRepo.closeSwarm({
      swarmId: BigInt(input.swarmId),
      status: input.status,
      completedAt: input.completedAt ?? new Date(),
      suggestionId:
        input.suggestionId === undefined
          ? undefined
          : input.suggestionId === null
            ? null
            : BigInt(input.suggestionId),
      reportFindingId:
        input.reportFindingId === undefined
          ? undefined
          : input.reportFindingId === null
            ? null
            : BigInt(input.reportFindingId),
    });
  }
}

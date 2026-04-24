import type { SimRunStatus } from "@interview/db-schema";
import type { SimRuntimeStore } from "@interview/sweep";
import type {
  InsertSimAgentInput,
  SimAgentRow,
} from "../types/sim-agent.types";
import type {
  SimMemoryRow,
  SimMemoryTopKByRecencyOpts,
  SimMemoryTopKByVectorOpts,
  SimMemoryWriteRow,
} from "../types/sim-memory.types";
import type { InsertSimRunInput, SimRunRow } from "../types/sim-run.types";
import type { InsertSimSwarmInput } from "../types/sim-swarm.types";
import type {
  InsertGodTurnInput,
  PersistTurnBatchInput,
  RecentObservableRow,
  SimGodEventRow,
} from "../types/sim-turn.types";

function extractGodEventDetail(action: unknown): string | undefined {
  if (!action || typeof action !== "object") return undefined;
  const detail = (action as { detail?: unknown }).detail;
  return typeof detail === "string" ? detail : undefined;
}

export interface SimRuntimeRunPort {
  insert(input: InsertSimRunInput): Promise<bigint>;
  findById(simRunId: bigint): Promise<SimRunRow | null>;
  updateStatus(
    simRunId: bigint,
    status: SimRunStatus,
    completedAt?: Date | null,
  ): Promise<void>;
}

export interface SimRuntimeAgentPort {
  insert(input: InsertSimAgentInput): Promise<bigint>;
  listByRun(simRunId: bigint): Promise<SimAgentRow[]>;
}

export interface SimRuntimeSwarmPort {
  insert(input: InsertSimSwarmInput): Promise<bigint>;
}

export interface SimRuntimeTurnPort {
  listGodEventsAtOrBefore(
    simRunId: bigint,
    turnIndex: number,
    limit?: number,
  ): Promise<SimGodEventRow[]>;
  insertGodTurn(input: InsertGodTurnInput): Promise<bigint>;
  persistTurnBatch(input: PersistTurnBatchInput): Promise<bigint[]>;
  countAgentTurnsForRun(simRunId: bigint): Promise<number>;
  lastTurnCreatedAt(simRunId: bigint): Promise<Date | null>;
  recentObservable(opts: {
    simRunId: bigint;
    sinceTurnIndex: number;
    excludeAgentId?: bigint;
    limit: number;
  }): Promise<RecentObservableRow[]>;
}

export interface SimRuntimeMemoryPort {
  writeMany(rows: SimMemoryWriteRow[]): Promise<bigint[]>;
  topKByVector(opts: SimMemoryTopKByVectorOpts): Promise<SimMemoryRow[]>;
  topKByRecency(opts: SimMemoryTopKByRecencyOpts): Promise<SimMemoryRow[]>;
}

export class SimRuntimeStoreService implements SimRuntimeStore {
  constructor(
    private readonly runRepo: SimRuntimeRunPort,
    private readonly agentRepo: SimRuntimeAgentPort,
    private readonly swarmRepo: SimRuntimeSwarmPort,
    private readonly turnRepo: SimRuntimeTurnPort,
    private readonly memoryRepo: SimRuntimeMemoryPort,
  ) {}

  async insertSwarm(input: Parameters<SimRuntimeStore["insertSwarm"]>[0]) {
    const id = await this.swarmRepo.insert({
      kind: input.kind,
      title: input.title,
      baseSeed: input.baseSeed,
      perturbations: input.perturbations,
      size: input.size,
      config: input.config,
      status: input.status,
      createdBy:
        input.createdBy === undefined || input.createdBy === null
          ? null
          : BigInt(input.createdBy),
    });
    return Number(id);
  }

  async insertRun(input: Parameters<SimRuntimeStore["insertRun"]>[0]) {
    const id = await this.runRepo.insert({
      swarmId: BigInt(input.swarmId),
      fishIndex: input.fishIndex,
      kind: input.kind,
      seedApplied: input.seedApplied,
      perturbation: input.perturbation,
      config: input.config,
      status: input.status,
    });
    return Number(id);
  }

  async insertAgent(input: Parameters<SimRuntimeStore["insertAgent"]>[0]) {
    const id = await this.agentRepo.insert({
      simRunId: BigInt(input.simRunId),
      operatorId:
        input.subjectId === null ? null : BigInt(input.subjectId),
      agentIndex: input.agentIndex,
      persona: input.persona,
      goals: input.goals,
      constraints: input.constraints,
    });
    return Number(id);
  }

  async getRun(simRunId: number) {
    const row = await this.runRepo.findById(BigInt(simRunId));
    if (!row) return null;
    return {
      swarmId: Number(row.swarmId),
      kind: row.kind,
      status: row.status,
      config: row.config,
    };
  }

  async listAgents(simRunId: number) {
    const rows = await this.agentRepo.listByRun(BigInt(simRunId));
    return rows.map((row) => ({
      id: Number(row.id),
      agentIndex: row.agentIndex,
      persona: row.persona,
      goals: row.goals,
      constraints: row.constraints,
    }));
  }

  async insertGodTurn(input: Parameters<SimRuntimeStore["insertGodTurn"]>[0]) {
    const id = await this.turnRepo.insertGodTurn({
      simRunId: BigInt(input.simRunId),
      turnIndex: input.turnIndex,
      action: input.action,
      rationale: input.rationale,
      observableSummary: input.observableSummary,
    });
    return Number(id);
  }

  async listGodEventsAtOrBefore(
    simRunId: number,
    turnIndex: number,
    limit: number = 10,
  ) {
    const rows = await this.turnRepo.listGodEventsAtOrBefore(
      BigInt(simRunId),
      turnIndex,
      limit,
    );
    return rows.map((row) => ({
      turnIndex: row.turnIndex,
      observableSummary: row.observableSummary,
      detail: extractGodEventDetail(row.action),
    }));
  }

  async persistTurnBatch(input: Parameters<SimRuntimeStore["persistTurnBatch"]>[0]) {
    const ids = await this.turnRepo.persistTurnBatch({
      agentTurns: input.agentTurns.map((turn) => ({
        simRunId: BigInt(turn.simRunId),
        turnIndex: turn.turnIndex,
        agentId: BigInt(turn.agentId),
        action: turn.action,
        rationale: turn.rationale,
        observableSummary: turn.observableSummary,
        llmCostUsd: turn.llmCostUsd ?? null,
      })),
      memoryRows: input.memoryRows.map((row) => ({
        simRunId: BigInt(row.simRunId),
        agentId: BigInt(row.agentId),
        turnIndex: row.turnIndex,
        kind: row.kind,
        content: row.content,
        embedding: row.embedding ?? null,
      })),
    });
    return ids.map(Number);
  }

  async writeMemoryBatch(rows: Parameters<SimRuntimeStore["writeMemoryBatch"]>[0]) {
    const ids = await this.memoryRepo.writeMany(
      rows.map((row) => ({
        simRunId: BigInt(row.simRunId),
        agentId: BigInt(row.agentId),
        turnIndex: row.turnIndex,
        kind: row.kind,
        content: row.content,
        embedding: row.embedding ?? null,
      })),
    );
    return ids.map(Number);
  }

  async updateRunStatus(
    simRunId: number,
    status: SimRunStatus,
    completedAt?: Date | null,
  ) {
    await this.runRepo.updateStatus(BigInt(simRunId), status, completedAt);
  }

  countAgentTurnsForRun(simRunId: number) {
    return this.turnRepo.countAgentTurnsForRun(BigInt(simRunId));
  }

  lastTurnCreatedAt(simRunId: number) {
    return this.turnRepo.lastTurnCreatedAt(BigInt(simRunId));
  }

  async recentObservable(
    opts: Parameters<SimRuntimeStore["recentObservable"]>[0],
  ) {
    const rows = await this.turnRepo.recentObservable({
      simRunId: BigInt(opts.simRunId),
      sinceTurnIndex: opts.sinceTurnIndex,
      excludeAgentId:
        opts.excludeAgentId === undefined ? undefined : BigInt(opts.excludeAgentId),
      limit: opts.limit,
    });
    return rows.map((row) => ({
      turnIndex: row.turnIndex,
      actorKind: row.actorKind,
      agentId: row.agentId === null ? null : Number(row.agentId),
      observableSummary: row.observableSummary,
    }));
  }

  async topKByVector(
    opts: Parameters<SimRuntimeStore["topKByVector"]>[0],
  ) {
    const rows = await this.memoryRepo.topKByVector({
      simRunId: BigInt(opts.simRunId),
      agentId: BigInt(opts.agentId),
      vec: opts.vec,
      k: opts.k,
    });
    return rows.map((row) => ({
      id: Number(row.id),
      turnIndex: row.turnIndex,
      kind: row.kind,
      content: row.content,
      score: row.score,
    }));
  }

  async topKByRecency(
    opts: Parameters<SimRuntimeStore["topKByRecency"]>[0],
  ) {
    const rows = await this.memoryRepo.topKByRecency({
      simRunId: BigInt(opts.simRunId),
      agentId: BigInt(opts.agentId),
      k: opts.k,
    });
    return rows.map((row) => ({
      id: Number(row.id),
      turnIndex: row.turnIndex,
      kind: row.kind,
      content: row.content,
      score: row.score,
    }));
  }
}

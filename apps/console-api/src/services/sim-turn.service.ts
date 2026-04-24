import type {
  InsertAgentTurnInput,
  InsertGodTurnInput,
  PersistTurnBatchInput,
  RecentObservableRow,
  SimGodEventRow,
} from "../types/sim-turn.types";

export interface SimTurnStorePort {
  insertAgentTurn(input: InsertAgentTurnInput): Promise<bigint>;
  persistTurnBatch(input: PersistTurnBatchInput): Promise<bigint[]>;
  insertGodTurn(input: InsertGodTurnInput): Promise<bigint>;
  listGodEventsAtOrBefore(
    simRunId: bigint,
    turnIndex: number,
    limit?: number,
  ): Promise<SimGodEventRow[]>;
  lastTurnCreatedAt(simRunId: bigint): Promise<Date | null>;
  recentObservable(opts: {
    simRunId: bigint;
    sinceTurnIndex: number;
    excludeAgentId?: bigint;
    limit: number;
  }): Promise<RecentObservableRow[]>;
}

export class SimTurnService {
  constructor(private readonly turnRepo: SimTurnStorePort) {}

  insertAgentTurn(input: InsertAgentTurnInput): Promise<bigint> {
    return this.turnRepo.insertAgentTurn(input);
  }

  persistTurnBatch(input: PersistTurnBatchInput): Promise<bigint[]> {
    return this.turnRepo.persistTurnBatch(input);
  }

  insertGodTurn(input: InsertGodTurnInput): Promise<bigint> {
    return this.turnRepo.insertGodTurn(input);
  }

  listGodEventsAtOrBefore(
    simRunId: bigint,
    turnIndex: number,
    limit?: number,
  ): Promise<SimGodEventRow[]> {
    return this.turnRepo.listGodEventsAtOrBefore(simRunId, turnIndex, limit);
  }

  lastTurnCreatedAt(simRunId: bigint): Promise<Date | null> {
    return this.turnRepo.lastTurnCreatedAt(simRunId);
  }

  recentObservable(opts: {
    simRunId: bigint;
    sinceTurnIndex: number;
    excludeAgentId?: bigint;
    limit: number;
  }): Promise<RecentObservableRow[]> {
    return this.turnRepo.recentObservable(opts);
  }
}

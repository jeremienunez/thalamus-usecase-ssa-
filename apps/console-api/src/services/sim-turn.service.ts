import type {
  InsertAgentTurnInput,
  InsertGodTurnInput,
  PersistTurnBatchInput,
  RecentObservableRow,
  SimGodEventRow,
  SimTurnRepository,
} from "../repositories/sim-turn.repository";

export class SimTurnService {
  constructor(
    private readonly turnRepo: Pick<
      SimTurnRepository,
      | "insertAgentTurn"
      | "persistTurnBatch"
      | "insertGodTurn"
      | "listGodEventsAtOrBefore"
      | "lastTurnCreatedAt"
      | "recentObservable"
    >,
  ) {}

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

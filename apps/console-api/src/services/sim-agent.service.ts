import type {
  InsertSimAgentInput,
  SimAgentRow,
} from "../types/sim-agent.types";

export interface SimAgentStorePort {
  insert(input: InsertSimAgentInput): Promise<bigint>;
  listByRun(simRunId: bigint): Promise<SimAgentRow[]>;
  countForRun(simRunId: bigint): Promise<number>;
}

export class SimAgentService {
  constructor(private readonly agentRepo: SimAgentStorePort) {}

  create(input: InsertSimAgentInput): Promise<bigint> {
    return this.agentRepo.insert(input);
  }

  listByRun(simRunId: bigint): Promise<SimAgentRow[]> {
    return this.agentRepo.listByRun(simRunId);
  }

  countForRun(simRunId: bigint): Promise<number> {
    return this.agentRepo.countForRun(simRunId);
  }
}

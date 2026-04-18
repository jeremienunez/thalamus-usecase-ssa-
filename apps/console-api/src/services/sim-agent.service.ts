import type {
  InsertSimAgentInput,
  SimAgentRepository,
  SimAgentRow,
} from "../repositories/sim-agent.repository";

export class SimAgentService {
  constructor(
    private readonly agentRepo: Pick<
      SimAgentRepository,
      "insert" | "listByRun" | "countForRun"
    >,
  ) {}

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

import type {
  InsertSimRunInput,
  SimRunRepository,
  SimRunRow,
} from "../repositories/sim-run.repository";
import type { SeedRefs, SimRunStatus } from "@interview/db-schema";
import type { SimAgentRepository } from "../repositories/sim-agent.repository";
import type { SimTurnRepository } from "../repositories/sim-turn.repository";

export class SimRunService {
  constructor(
    private readonly runRepo: Pick<
      SimRunRepository,
      "insert" | "findById" | "updateStatus" | "getSeedApplied"
    >,
    private readonly agentRepo: Pick<SimAgentRepository, "countForRun">,
    private readonly turnRepo: Pick<SimTurnRepository, "countAgentTurnsForRun">,
  ) {}

  create(input: InsertSimRunInput): Promise<bigint> {
    return this.runRepo.insert(input);
  }

  findById(simRunId: bigint): Promise<SimRunRow | null> {
    return this.runRepo.findById(simRunId);
  }

  updateStatus(
    simRunId: bigint,
    status: SimRunStatus,
    completedAt?: Date | null,
  ): Promise<void> {
    return this.runRepo.updateStatus(simRunId, status, completedAt);
  }

  getSeedApplied(simRunId: bigint): Promise<SeedRefs | null> {
    return this.runRepo.getSeedApplied(simRunId);
  }

  countAgentsForRun(simRunId: bigint): Promise<number> {
    return this.agentRepo.countForRun(simRunId);
  }

  countAgentTurnsForRun(simRunId: bigint): Promise<number> {
    return this.turnRepo.countAgentTurnsForRun(simRunId);
  }
}

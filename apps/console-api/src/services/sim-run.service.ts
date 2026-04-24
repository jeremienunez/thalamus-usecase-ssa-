import type {
  InsertSimRunInput,
  SimRunRow,
  SimSwarmFishCounts,
} from "../types/sim-run.types";
import type { SeedRefs, SimRunStatus } from "@interview/db-schema";

export interface SimRunStorePort {
  insert(input: InsertSimRunInput): Promise<bigint>;
  findById(simRunId: bigint): Promise<SimRunRow | null>;
  updateStatus(
    simRunId: bigint,
    status: SimRunStatus,
    completedAt?: Date | null,
  ): Promise<void>;
  getSeedApplied(simRunId: bigint): Promise<SeedRefs | null>;
}

export interface SimRunAgentCountPort {
  countForRun(simRunId: bigint): Promise<number>;
}

export interface SimRunTurnCountPort {
  countAgentTurnsForRun(simRunId: bigint): Promise<number>;
}

export interface SimRunFishCountPort {
  countFishByStatus(swarmId: bigint): Promise<SimSwarmFishCounts>;
}

export class SimRunService {
  constructor(
    private readonly runRepo: SimRunStorePort,
    private readonly agentRepo: SimRunAgentCountPort,
    private readonly turnRepo: SimRunTurnCountPort,
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

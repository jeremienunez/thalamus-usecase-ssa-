import type {
  InsertSimSwarmInput,
  LinkOutcomeInput,
  SimSwarmRow,
} from "../types/sim-swarm.types";
import type { SimSwarmFishCounts } from "../types/sim-run.types";

export interface SimSwarmStorePort {
  insert(input: InsertSimSwarmInput): Promise<bigint>;
  findById(swarmId: bigint): Promise<SimSwarmRow | null>;
  markDone(swarmId: bigint): Promise<void>;
  markFailed(swarmId: bigint): Promise<void>;
  linkOutcome(swarmId: bigint, refs: LinkOutcomeInput): Promise<void>;
}

export interface SimSwarmRunCountPort {
  countFishByStatus(swarmId: bigint): Promise<SimSwarmFishCounts>;
}

export class SimSwarmService {
  constructor(
    private readonly swarmRepo: SimSwarmStorePort,
    private readonly runRepo: SimSwarmRunCountPort,
  ) {}

  create(input: InsertSimSwarmInput): Promise<bigint> {
    return this.swarmRepo.insert(input);
  }

  findById(swarmId: bigint): Promise<SimSwarmRow | null> {
    return this.swarmRepo.findById(swarmId);
  }

  markDone(swarmId: bigint): Promise<void> {
    return this.swarmRepo.markDone(swarmId);
  }

  markFailed(swarmId: bigint): Promise<void> {
    return this.swarmRepo.markFailed(swarmId);
  }

  linkOutcome(swarmId: bigint, refs: LinkOutcomeInput): Promise<void> {
    return this.swarmRepo.linkOutcome(swarmId, refs);
  }

  countFishByStatus(swarmId: bigint): Promise<SimSwarmFishCounts> {
    return this.runRepo.countFishByStatus(swarmId);
  }
}

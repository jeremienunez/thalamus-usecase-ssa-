import type {
  InsertSimSwarmInput,
  LinkOutcomeInput,
  SimSwarmRepository,
  SimSwarmRow,
} from "../repositories/sim-swarm.repository";
import type { SimRunRepository, SimSwarmFishCounts } from "../repositories/sim-run.repository";

export class SimSwarmService {
  constructor(
    private readonly swarmRepo: Pick<
      SimSwarmRepository,
      "insert" | "findById" | "markDone" | "markFailed" | "linkOutcome"
    >,
    private readonly runRepo: Pick<SimRunRepository, "countFishByStatus">,
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

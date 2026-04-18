import type {
  SimMemoryRepository,
  SimMemoryRow,
  SimMemoryWriteRow,
} from "../repositories/sim-memory.repository";

export class SimMemoryService {
  constructor(
    private readonly memoryRepo: Pick<
      SimMemoryRepository,
      "writeMany" | "topKByVector" | "topKByRecency"
    >,
  ) {}

  writeMany(rows: SimMemoryWriteRow[]): Promise<bigint[]> {
    return this.memoryRepo.writeMany(rows);
  }

  topKByVector(opts: {
    simRunId: bigint;
    agentId: bigint;
    vec: number[];
    k: number;
  }): Promise<SimMemoryRow[]> {
    return this.memoryRepo.topKByVector(opts);
  }

  topKByRecency(opts: {
    simRunId: bigint;
    agentId: bigint;
    k: number;
  }): Promise<SimMemoryRow[]> {
    return this.memoryRepo.topKByRecency(opts);
  }
}

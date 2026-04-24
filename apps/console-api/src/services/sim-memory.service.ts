import type {
  SimMemoryRow,
  SimMemoryTopKByRecencyOpts,
  SimMemoryTopKByVectorOpts,
  SimMemoryWriteRow,
} from "../types/sim-memory.types";

export interface SimMemoryStorePort {
  writeMany(rows: SimMemoryWriteRow[]): Promise<bigint[]>;
  topKByVector(opts: SimMemoryTopKByVectorOpts): Promise<SimMemoryRow[]>;
  topKByRecency(opts: SimMemoryTopKByRecencyOpts): Promise<SimMemoryRow[]>;
}

export class SimMemoryService {
  constructor(private readonly memoryRepo: SimMemoryStorePort) {}

  writeMany(rows: SimMemoryWriteRow[]): Promise<bigint[]> {
    return this.memoryRepo.writeMany(rows);
  }

  topKByVector(opts: SimMemoryTopKByVectorOpts): Promise<SimMemoryRow[]> {
    return this.memoryRepo.topKByVector(opts);
  }

  topKByRecency(opts: SimMemoryTopKByRecencyOpts): Promise<SimMemoryRow[]> {
    return this.memoryRepo.topKByRecency(opts);
  }
}

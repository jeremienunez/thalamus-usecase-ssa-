import type {
  InsertSimRunInput,
  SimRunRow,
  SimSwarmFishCounts,
} from "../types/sim-run.types";
import type { SeedRefs, SimRunStatus, TemporalSourceDomain } from "@interview/db-schema";

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

export interface SimRunTemporalSeedPort {
  insert(input: {
    patternId: bigint;
    simRunId: bigint;
    seedReason: string;
    sourceDomain: Exclude<TemporalSourceDomain, "production" | "mixed">;
  }): Promise<unknown>;
}

export class SimRunService {
  constructor(
    private readonly runRepo: SimRunStorePort,
    private readonly agentRepo: SimRunAgentCountPort,
    private readonly turnRepo: SimRunTurnCountPort,
    private readonly temporalSeededRunRepo?: SimRunTemporalSeedPort,
  ) {}

  async create(input: InsertSimRunInput): Promise<bigint> {
    const simRunId = await this.runRepo.insert(input);
    await this.linkTemporalSeedIfPresent(input.seedApplied, simRunId);
    return simRunId;
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

  private async linkTemporalSeedIfPresent(
    seedApplied: SeedRefs,
    simRunId: bigint,
  ): Promise<void> {
    if (!this.temporalSeededRunRepo) return;
    const patternId = parseSeededByPatternId(seedApplied);
    if (patternId === null) return;
    await this.temporalSeededRunRepo.insert({
      patternId,
      simRunId,
      seedReason: "followup_seeded_by_temporal_pattern",
      sourceDomain: "simulation_seeded",
    });
  }
}

function parseSeededByPatternId(seedApplied: SeedRefs): bigint | null {
  const raw =
    readSeedString(seedApplied, "seeded_by_pattern_id") ??
    readSeedString(seedApplied, "seededByPatternId");
  if (raw === null || !/^[1-9]\d*$/.test(raw)) return null;
  return BigInt(raw);
}

function readSeedString(seedApplied: SeedRefs, key: string): string | null {
  const value = seedApplied[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "bigint" && value > 0n) {
    return value.toString();
  }
  return null;
}

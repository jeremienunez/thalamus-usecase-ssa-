import type {
  PerturbationSpec,
  SeedRefs,
  SimConfig,
  SimKind,
  SimRunStatus,
} from "@interview/db-schema";

export interface SimRunRow {
  id: bigint;
  swarmId: bigint;
  fishIndex: number;
  kind: SimKind;
  seedApplied: SeedRefs;
  perturbation: PerturbationSpec;
  config: SimConfig;
  status: SimRunStatus;
  reportFindingId: bigint | null;
  llmCostUsd: number | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface InsertSimRunInput {
  swarmId: bigint;
  fishIndex: number;
  kind: SimKind;
  seedApplied: SeedRefs;
  perturbation: PerturbationSpec;
  config: SimConfig;
  status?: SimRunStatus;
}

export interface SimSwarmFishCounts {
  done: number;
  failed: number;
  running: number;
  pending: number;
  paused: number;
}

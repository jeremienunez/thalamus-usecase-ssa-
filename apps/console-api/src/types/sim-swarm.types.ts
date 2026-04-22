import type {
  PerturbationSpec,
  SeedRefs,
  SimKind,
  SimSwarmStatus,
  SwarmConfig,
} from "@interview/db-schema";

export interface SimSwarmRow {
  id: bigint;
  kind: SimKind;
  title: string;
  baseSeed: SeedRefs;
  perturbations: PerturbationSpec[];
  size: number;
  config: SwarmConfig;
  status: SimSwarmStatus;
  outcomeReportFindingId: bigint | null;
  suggestionId: bigint | null;
  startedAt: Date;
  completedAt: Date | null;
  createdBy: bigint | null;
}

export interface InsertSimSwarmInput {
  kind: SimKind;
  title: string;
  baseSeed: SeedRefs;
  perturbations: PerturbationSpec[];
  size: number;
  config: SwarmConfig;
  status?: SimSwarmStatus;
  createdBy?: bigint | null;
}

export interface LinkOutcomeInput {
  reportFindingId?: bigint | null;
  suggestionId?: bigint | null;
}

export interface SnapshotAggregateInput {
  swarmId: bigint;
  key: string;
  value: Record<string, unknown>;
}

export interface CloseSimSwarmInput {
  swarmId: bigint;
  status: "done" | "failed";
  suggestionId?: bigint | null;
  reportFindingId?: bigint | null;
  completedAt?: Date;
}

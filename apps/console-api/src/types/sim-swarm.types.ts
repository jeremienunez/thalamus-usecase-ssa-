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

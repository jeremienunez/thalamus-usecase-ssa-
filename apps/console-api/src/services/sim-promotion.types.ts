import type { SweepRepository } from "@interview/sweep";
import type { FindByIdFullRow } from "../types/satellite.types";
import type { ResearchWriterPort } from "@interview/thalamus";

export interface SimPromotionSatellitePort {
  findByIdFull(id: bigint | number): Promise<FindByIdFullRow | null>;
  findNullTelemetryColumns(satelliteId: bigint): Promise<Set<string>>;
}

export interface SimPromotionSwarmPort {
  linkOutcome(
    swarmId: bigint,
    refs: { reportFindingId?: bigint | null; suggestionId?: bigint | null },
  ): Promise<void>;
}

export type SimPromotionResearchWriterPort = Pick<
  ResearchWriterPort,
  | "createCycle"
  | "createFinding"
  | "linkFindingToCycle"
  | "createEdges"
  | "updateCycleFindingsCount"
>;

export type SimSuggestionWritePort = Pick<SweepRepository, "insertGeneric">;

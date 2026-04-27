import type { SimPromoteInput, SimPromoteResult } from "@interview/sweep";
import type { SimSuggestionWritePort } from "./sim-promotion.types";

export interface SimOutcomePromotionDeps {
  sweepRepo: SimSuggestionWritePort;
}

export class SimOutcomePromotionService {
  constructor(private readonly deps: SimOutcomePromotionDeps) {}

  async promote(input: SimPromoteInput): Promise<SimPromoteResult> {
    const suggestionId = await this.deps.sweepRepo.insertGeneric({
      domain: "ssa",
      domainFields: {
        operatorCountryId: null,
        operatorCountryName: "sim-swarm",
        category: "relationship_error",
        severity: "warning",
        title: input.label,
        description:
          typeof input.evidence?.summary === "string"
            ? input.evidence.summary
            : input.label,
        affectedSatellites: 0,
        suggestedAction:
          typeof input.action.kind === "string"
            ? String(input.action.kind)
            : input.label,
        webEvidence: null,
      },
      resolutionPayload: null,
      simSwarmId: String(input.swarmId),
      simDistribution: JSON.stringify(input.distribution),
    });
    return { suggestionId };
  }
}

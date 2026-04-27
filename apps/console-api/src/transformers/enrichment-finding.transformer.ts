// apps/console-api/src/transformers/enrichment-finding.transformer.ts
import type {
  EmitArgs,
  SweepFeedbackEntry,
  EnrichmentFindingEvidence,
  EnrichmentFindingInsert,
} from "../types/sweep.types";
import {
  ResearchCortex,
  ResearchFindingType,
  ResearchUrgency,
} from "@interview/shared/enum";

export function toEnrichmentFindingInsert(
  args: EmitArgs,
  cycleId: bigint,
): EnrichmentFindingInsert {
  const title = `${args.kind === "knn" ? "KNN" : "Mission"} fill · ${args.field}=${args.value}`;
  const summary =
    args.kind === "knn"
      ? `${args.field} propagated to satellite #${args.satelliteId} from ${args.neighbourIds?.length ?? 0} semantically similar payloads (cos_sim=${args.cosSim?.toFixed(3) ?? "?"}).`
      : `${args.field} written to satellite #${args.satelliteId} from web-search source (confidence=${args.confidence.toFixed(2)}).`;
  const evidence: EnrichmentFindingEvidence[] =
    args.kind === "knn"
      ? [
          {
            source: "knn",
            data: {
              field: args.field,
              value: args.value,
              cosSim: args.cosSim,
              neighbours: args.neighbourIds ?? [],
            },
            weight: args.confidence,
          },
        ]
      : [
          {
            source: "web",
            data: { field: args.field, value: args.value, url: args.source },
            weight: args.confidence,
          },
        ];
  const reasoning =
    args.kind === "knn"
      ? `Zero-LLM propagation: median consensus of K=${args.neighbourIds?.length ?? 0} nearest payloads in Voyage halfvec(2048) space.`
      : `Web-mission 2-vote corroboration: two independent nano calls agreed on this value from ${args.source}.`;

  return {
    cycleId,
    cortex: ResearchCortex.DataAuditor,
    findingType: ResearchFindingType.Insight,
    urgency: ResearchUrgency.Low,
    title,
    summary,
    evidence,
    reasoning,
    confidence: args.confidence,
    impactScore: 0.3,
  };
}

export function toSweepFeedbackEntry(args: EmitArgs): SweepFeedbackEntry {
  return {
    category: "enrichment",
    wasAccepted: true,
    reviewerNote: `${args.kind}-fill: ${args.field}=${args.value}`,
    operatorCountryName:
      args.kind === "knn" ? "knn-propagation" : "web-mission",
  };
}

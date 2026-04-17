// apps/console-api/src/transformers/sweep-suggestions.transformer.ts
/**
 * Transformer for sweep suggestion rows → API list items.
 *
 * Keeps row→view projection out of the service layer so controllers and
 * services stay free of inline shape-building.
 */
import type {
  SweepSuggestionRow,
  SuggestionListItem,
} from "../types/sweep.types";

export function toSuggestionListItem(r: SweepSuggestionRow): SuggestionListItem {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    suggestedAction: r.suggestedAction,
    category: r.category,
    severity: r.severity,
    operatorCountryName: r.operatorCountryName,
    affectedSatellites: r.affectedSatellites,
    createdAt: r.createdAt,
    accepted: r.accepted,
    resolutionStatus: r.resolutionStatus,
    hasPayload: Boolean(r.resolutionPayload),
  };
}

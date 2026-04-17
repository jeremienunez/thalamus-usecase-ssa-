/**
 * SweepPromotionAdapter — engine → pack.
 *
 * After SweepResolutionService's action handler returns ok, the engine
 * calls promote() to apply the accepted suggestion side-effects (KG write,
 * domain table update, audit log). Pack owns everything here; engine only
 * receives a result.
 */

export interface AcceptedSuggestionInput {
  suggestionId: string;
  domain: string;
  domainFields: Record<string, unknown>;
  resolutionPayload: string | null;
  reviewer: string | null;
  reviewerNote: string | null;
}

export interface PromotionResult {
  ok: boolean;
  /** KG finding id when a finding was written. Optional — pack decides. */
  kgFindingId?: string;
  errors?: string[];
}

export interface SweepPromotionAdapter {
  promote(input: AcceptedSuggestionInput): Promise<PromotionResult>;
}

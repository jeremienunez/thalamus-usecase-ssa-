/**
 * ResolutionHandlerRegistry — engine → pack.
 *
 * SweepResolutionService.resolve() dispatches on `action.kind` to a
 * pack-provided handler. The handler performs the SSA-specific side-effect
 * (UPDATE a row, link a payload, reassign an operator-country, etc.) and
 * returns ok/pending/errors. The engine then calls the promotion adapter.
 *
 * The `selectors` field on ResolutionActionContext carries the optional
 * 2-arg form of .resolve(id, selectors) for ambiguous-match disambiguation.
 */

export interface ResolutionActionContext {
  suggestionId: string;
  reviewer: string | null;
  reviewerNote: string | null;
  /** Selectors from the original .resolve(id, selections) 2-arg façade. */
  selectors?: Record<string, unknown>;
  /**
   * Domain-scoped suggestion metadata the engine extracts from the generic
   * row's domainFields. SSA handlers read `operatorCountryId` here.
   */
  domainContext?: Record<string, unknown>;
}

export interface ResolutionSelectionOption {
  value: string | number;
  label: string;
  detail?: string;
}

/**
 * Describes an ambiguous match the reviewer must disambiguate before the
 * handler can apply its side-effect. The engine surfaces the list back to
 * the caller; the caller re-invokes .resolve(id, selectors) with a choice
 * keyed by `key`.
 */
export interface ResolutionPendingSelection {
  key: string;
  label: string;
  options: ResolutionSelectionOption[];
}

export interface ResolutionHandlerResult {
  ok: boolean;
  /** Number of rows mutated by the handler; preserved for ResolutionResult. */
  affectedRows: number;
  /**
   * When the handler needs user disambiguation (e.g. multiple satellites
   * match the payload), it returns one or more pending selections.
   * Engine surfaces these back to the caller without calling promotion.
   */
  pending?: ResolutionPendingSelection[];
  errors?: string[];
}

export interface ResolutionHandler {
  /** Action kind this handler services — matches the `kind` field of resolutionPayload. */
  kind: string;
  handle(
    action: Record<string, unknown>,
    ctx: ResolutionActionContext,
  ): Promise<ResolutionHandlerResult>;
}

export interface ResolutionHandlerRegistry {
  get(kind: string): ResolutionHandler | undefined;
  list(): ResolutionHandler[];
}

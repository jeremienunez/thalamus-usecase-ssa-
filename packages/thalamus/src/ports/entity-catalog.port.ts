/**
 * EntityCatalogPort — domain-owned adapter for KG-edge name resolution
 * and orphan cleanup.
 *
 * The thalamus kernel writes edges to `research_edge` keyed by
 * `(entityType, entityId)` but does not know which tables those ids live
 * in. Domains ship an adapter that answers two questions:
 *   - "what display names correspond to this batch of refs?"
 *   - "which rows in research_edge point at entities that no longer exist?"
 *
 * Default: `NoopEntityCatalog` (returns empty Map, cleans 0 rows). Used by
 * tests and by standalone package consumers that don't run cycles.
 */

export interface EntityRef {
  entityType: string;
  entityId: bigint;
}

export interface EntityCatalogPort {
  /**
   * Resolve display names for a batch of (entityType, entityId) pairs.
   * Returns `Map<"type:id", name>`. Missing keys are silently omitted —
   * callers render missing keys with a fallback.
   */
  resolveNames(refs: EntityRef[]): Promise<Map<string, string>>;

  /**
   * Delete edges in `research_edge` whose target entity no longer exists
   * in the domain catalog. Returns deleted row count.
   */
  cleanOrphans(): Promise<number>;
}

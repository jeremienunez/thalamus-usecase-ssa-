/**
 * FindingDomainSchema — kernel ↔ pack contract for the `sweep_suggestion` row.
 *
 * The pack owns the domain shape: what fields to index, how to serialize a
 * domain-typed insert into the Redis hash the engine writes, and how to
 * reconstruct the domain-typed row on read. The kernel never touches a
 * domain field by name.
 */

/**
 * Generic row returned by SweepRepository.listGeneric / getGeneric after the
 * pack's schema.deserialize runs. Engine + unrelated consumers see opaque
 * `domainFields`.
 */
export interface GenericSuggestionRow {
  id: string;
  domain: string;
  createdAt: string;
  accepted: boolean | null;
  reviewedAt: string | null;
  reviewerNote: string | null;
  resolutionStatus: string;
  resolvedAt: string | null;
  resolutionErrors: string | null;
  simSwarmId: string | null;
  simDistribution: string | null;
  /** Domain payload reconstituted by schema.deserialize. */
  domainFields: Record<string, unknown>;
  resolutionPayload: string | null;
}

/**
 * Generic insert as produced by DomainAuditProvider candidates or by a direct
 * caller of SweepRepository.insertGeneric.
 */
export interface GenericInsertSuggestion {
  domain: string;
  domainFields: Record<string, unknown>;
  resolutionPayload: string | null;
  simSwarmId?: string | null;
  simDistribution?: string | null;
}

/**
 * The pack supplies this to the container at wiring time. It decides how
 * domain payloads map into and out of the Redis storage format.
 *
 * Today the SSA implementation maps to the existing flat schema
 * (operatorCountryName, category, severity, title, description, ...) so no
 * Redis data migration is needed. Future domains can supply a different
 * field layout through the same port.
 */
export interface FindingDomainSchema {
  /**
   * Validate + project the domain payload into two buckets:
   *   - flatFields: hash fields stored at the top level of `sweep:suggestions:{id}`
   *     (used for filtering / listing)
   *   - blob: any JSON-shaped extras that don't need to be filterable;
   *     stored in a companion key (empty object today for SSA)
   */
  serialize(input: Record<string, unknown>): {
    flatFields: Record<string, string | number | null>;
    blob: Record<string, unknown>;
  };

  /**
   * Reverse of serialize: reconstruct the domain payload from the Redis
   * hash + blob read.
   */
  deserialize(raw: {
    flatFields: Record<string, string | null>;
    blob: Record<string, unknown>;
  }): Record<string, unknown>;

  /**
   * Flat field names that the pack wants exposed on the list query for
   * filtering. Engine uses this to decide which fields to read/write as
   * indexed columns; fields not in this list go through the blob.
   */
  indexedFields: string[];
}

/**
 * FindingRoutingPolicy — engine → pack.
 *
 * Decides which tiers receive a finding produced by a given source
 * (cortex name, sweep, research-cycle). Tiers are domain-defined strings
 * (e.g. "investment" | "franchise" | "enthusiast" | "admin" for SSA).
 */

export type FindingTier = string;

export interface FindingSource {
  /** e.g. "cortex", "sweep", "research-cycle" */
  kind: string;
  /** cortex name for kind=cortex; source tag otherwise */
  name: string;
}

export interface FindingRoutingPolicy {
  tiersForSource(source: FindingSource): FindingTier[];
}

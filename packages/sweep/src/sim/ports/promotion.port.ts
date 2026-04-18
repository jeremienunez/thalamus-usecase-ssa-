/**
 * SimPromotionAdapter — kernel ↔ pack contract for post-aggregation promotion.
 *
 * When the swarm aggregator emits a modal action, the kernel hands it to the
 * pack's promotion adapter. The SSA impl wraps Plan 1's SsaPromotionAdapter:
 * zero duplicate KG-write logic — the sim-sourced suggestion flows through
 * the SAME promotion path as sweep-sourced ones.
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.9 (impl).
 */

export interface SimPromoteInput {
  swarmId: number;
  /** Modal cluster action payload — pack shape. */
  action: Record<string, unknown>;
  /** Pack-defined distribution snapshot stored on the suggestion row. */
  distribution: Record<string, unknown>;
  /** Kernel-provided summary for reviewer UI. */
  label: string;
  /** Optional free-form evidence rendered into the suggestion. */
  evidence?: Record<string, unknown>;
}

export interface SimPromoteResult {
  suggestionId: string;
  findingId?: number;
}

export interface SimPromotionAdapter {
  promote(input: SimPromoteInput): Promise<SimPromoteResult>;
}

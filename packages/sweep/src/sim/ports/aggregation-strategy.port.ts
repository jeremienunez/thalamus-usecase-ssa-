/**
 * SimAggregationStrategy — kernel ↔ pack contract for cluster labelling.
 *
 * Kernel clustering is generic (k-means on embeddings, cosine/l2 distance).
 * The pack contributes only the domain-specific labelling: how to name a
 * cluster's action ("maneuver / wait / evaluate_telemetry / ...") and how
 * to fall back when embeddings are missing.
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.8 (impl lifts labelFromAction
 * + clusterByActionKind from packages/sweep/src/sim/aggregator.service.ts).
 */

export interface AggregationInput {
  /** Per-fish terminal action payload. Pack shape — kernel opaque. */
  action: Record<string, unknown> | null;
  fishIndex: number;
  /** Per-fish terminal embedding (kernel computes). */
  embedding?: number[] | null;
}

export interface AggregationCluster {
  label: string;
  fraction: number;
  memberFishIndexes: number[];
}

export interface SimAggregationStrategy {
  /** Human-readable cluster label from a representative action. */
  labelAction(action: Record<string, unknown> | null): string;

  /**
   * Fallback clustering when the kernel can't embed (fewer than 2 vectors,
   * all-null embeddings, etc.). Groups by action kind.
   */
  clusterFallback(inputs: AggregationInput[]): AggregationCluster[];
}

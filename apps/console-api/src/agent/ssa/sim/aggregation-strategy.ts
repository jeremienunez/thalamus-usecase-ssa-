/**
 * SsaAggregationStrategy — cluster labelling for SSA modal actions.
 *
 * TODO(Plan 2 · B.8): lift from
 *   packages/sweep/src/sim/aggregator.service.ts:
 *     - labelFromAction(action): "maneuver | wait | evaluate_telemetry | ..."
 *     - clusterByActionKind(inputs): fallback when embeddings unusable
 *
 * Kernel keeps the generic k-means + cosine/l2 pieces.
 */

import type {
  SimAggregationStrategy,
  AggregationInput,
  AggregationCluster,
} from "@interview/sweep";

export class SsaAggregationStrategy implements SimAggregationStrategy {
  labelAction(_action: Record<string, unknown> | null): string {
    // TODO(B.8): switch on action.kind to return human label.
    throw new Error("SsaAggregationStrategy.labelAction: TODO Plan 2 · B.8");
  }

  clusterFallback(_inputs: AggregationInput[]): AggregationCluster[] {
    // TODO(B.8): group by action.kind, compute fraction, return clusters.
    throw new Error(
      "SsaAggregationStrategy.clusterFallback: TODO Plan 2 · B.8",
    );
  }
}

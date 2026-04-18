/**
 * LegacySsaAggregationStrategy — fallback SimAggregationStrategy.
 *
 * Mirror of apps/console-api/src/agent/ssa/sim/aggregation-strategy.ts.
 * Deleted at Plan 2 Étape 4.
 */

import type {
  AggregationCluster,
  AggregationInput,
  SimAggregationStrategy,
} from "./ports";

type SsaAction =
  | { kind: "maneuver"; satelliteId: number }
  | { kind: "propose_split"; ownShareDeltaV: number }
  | { kind: "accept" }
  | { kind: "reject" }
  | { kind: "launch"; satelliteCount: number }
  | { kind: "retire"; satelliteId: number }
  | { kind: "lobby"; policyTopic: string; stance: "support" | "oppose" }
  | { kind: "hold" }
  | { kind: "infer_telemetry" }
  | { kind: "estimate_pc" };

export class LegacySsaAggregationStrategy implements SimAggregationStrategy {
  labelAction(action: Record<string, unknown> | null): string {
    if (!action) return "unknown";
    const a = action as SsaAction;
    switch (a.kind) {
      case "maneuver":
        return `maneuver sat#${a.satelliteId}`;
      case "propose_split":
        return `propose (own Δv=${a.ownShareDeltaV.toFixed(0)})`;
      case "accept":
        return "accept";
      case "reject":
        return "reject";
      case "launch":
        return `launch +${a.satelliteCount}`;
      case "retire":
        return `retire sat#${a.satelliteId}`;
      case "lobby":
        return `lobby ${a.policyTopic} (${a.stance})`;
      case "hold":
        return "hold";
      case "infer_telemetry":
        return "infer_telemetry";
      case "estimate_pc":
        return "estimate_pc";
      default:
        return "unknown";
    }
  }

  clusterFallback(inputs: AggregationInput[]): AggregationCluster[] {
    const buckets = new Map<string, AggregationInput[]>();
    for (const f of inputs) {
      const key = ((f.action as { kind?: string } | null)?.kind) ?? "unknown";
      const arr = buckets.get(key) ?? [];
      arr.push(f);
      buckets.set(key, arr);
    }
    const total = inputs.length;
    const out: AggregationCluster[] = [];
    for (const [kind, members] of buckets) {
      out.push({
        label: kind,
        fraction: members.length / total,
        memberFishIndexes: members.map((m) => m.fishIndex).sort((a, b) => a - b),
      });
    }
    return out;
  }
}

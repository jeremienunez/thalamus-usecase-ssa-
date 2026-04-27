import { ResearchEntityType } from "@interview/shared";
import type { SwarmAggregate } from "@interview/sweep";

export type SsaAction =
  | {
      kind: "maneuver";
      satelliteId: number;
      deltaVmps: number;
    }
  | {
      kind: "propose_split";
      ownShareDeltaV: number;
      counterpartyShareDeltaV: number;
    }
  | { kind: "accept" }
  | { kind: "reject" }
  | { kind: "launch"; satelliteCount: number; regimeId?: number | null }
  | { kind: "retire"; satelliteId: number }
  | { kind: "lobby"; policyTopic: string; stance: "support" | "oppose" }
  | { kind: "hold" };

export function telemetryColumn(key: string): string | null {
  switch (key) {
    case "powerDraw":
      return "power_draw";
    case "thermalMargin":
      return "thermal_margin";
    case "pointingAccuracy":
      return "pointing_accuracy";
    case "attitudeRate":
      return "attitude_rate";
    case "linkBudget":
      return "link_budget";
    case "dataRate":
      return "data_rate";
    case "payloadDuty":
      return "payload_duty";
    case "eclipseRatio":
      return "eclipse_ratio";
    default:
      return null;
  }
}

export function actionTarget(
  action: SsaAction,
):
  | { entityType: ResearchEntityType.Satellite; entityId: number }
  | { entityType: ResearchEntityType.Operator; entityId: number }
  | null {
  switch (action.kind) {
    case "maneuver":
    case "retire":
      return {
        entityType: ResearchEntityType.Satellite,
        entityId: action.satelliteId,
      };
    default:
      return null;
  }
}

export function composeTitle(swarmId: number, agg: SwarmAggregate): string {
  if (!agg.modal) return `Swarm ${swarmId}: no modal`;
  const pct = Math.round(agg.modal.fraction * 100);
  return `Swarm ${swarmId} consensus (${pct}% of ${agg.succeededFish}): ${describeAction(
    agg.modal.exemplarAction as SsaAction,
  )}`;
}

export function composeDescription(
  agg: SwarmAggregate,
  operatorName: string | null,
): string {
  if (!agg.modal) return "Swarm produced no modal outcome.";
  const target = operatorName ? ` targeting ${operatorName}'s fleet` : "";
  const divergencePct = Math.round(agg.divergenceScore * 100);
  const clusterLines = agg.clusters
    .slice(0, 5)
    .map(
      (cluster) =>
        `  - ${Math.round(cluster.fraction * 100)}% ${cluster.label} (exemplar sim_run=${cluster.exemplarSimRunId})`,
    )
    .join("\n");
  return [
    `A UC3 conjunction-negotiation swarm${target} converged on "${describeAction(
      agg.modal.exemplarAction as SsaAction,
    )}" in ${Math.round(agg.modal.fraction * 100)}% of explored futures (n=${agg.succeededFish}, ${agg.failedFish} failed).`,
    "",
    `Divergence: ${divergencePct}% (${agg.clusters.length} clusters).`,
    "",
    "Distribution:",
    clusterLines,
  ].join("\n");
}

export function describeAction(action: SsaAction): string {
  switch (action.kind) {
    case "maneuver":
      return `maneuver satellite #${action.satelliteId} (delta-v ~= ${action.deltaVmps.toFixed(1)} m/s)`;
    case "propose_split":
      return `propose split (own delta-v=${action.ownShareDeltaV.toFixed(0)} / counterparty=${action.counterpartyShareDeltaV.toFixed(0)})`;
    case "accept":
      return "accept counterparty proposal";
    case "reject":
      return "reject counterparty proposal";
    case "launch":
      return `launch +${action.satelliteCount}${action.regimeId ? ` into regime ${action.regimeId}` : ""}`;
    case "retire":
      return `retire satellite #${action.satelliteId}`;
    case "lobby":
      return `lobby ${action.policyTopic} (${action.stance})`;
    case "hold":
      return "hold";
  }
}

export function scoreScalar(
  stats: { median: number; sigma: number; n: number },
  simConfidence: number,
): {
  severity: "critical" | "warning" | "info";
  sourceClass: "SIM_UNCORROBORATED";
} {
  const cv =
    Math.abs(stats.median) > 1e-9 ? stats.sigma / Math.abs(stats.median) : 1;
  const enoughSamples = stats.n >= 5;
  const tightConsensus = cv < 0.2 && simConfidence >= 0.2 && enoughSamples;
  const highDispersion = cv >= 0.5 && enoughSamples;
  return {
    severity: tightConsensus || highDispersion ? "warning" : "info",
    sourceClass: "SIM_UNCORROBORATED",
  };
}

export function round(n: number, digits: number): number {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}

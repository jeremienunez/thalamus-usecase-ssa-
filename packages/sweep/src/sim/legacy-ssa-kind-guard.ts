/**
 * LegacySsaKindGuard — fallback SimKindGuard.
 *
 * Mirror of apps/console-api/src/agent/ssa/sim/kind-guard.ts. Deleted at
 * Plan 2 Étape 4.
 */

import type { SimKindGuard } from "./ports";

const SSA_KINDS = new Set<string>([
  "uc1_operator_behavior",
  "uc3_conjunction",
  "uc_telemetry_inference",
  "uc_pc_estimator",
]);

export class LegacySsaKindGuard implements SimKindGuard {
  validateLaunch(args: {
    kind: string;
    baseSeed: Record<string, unknown>;
  }): void {
    const { kind, baseSeed } = args;
    if (!SSA_KINDS.has(kind)) {
      throw new Error(`LegacySsaKindGuard: unsupported sim kind "${kind}"`);
    }
    const operatorIds = (baseSeed.operatorIds as number[] | undefined) ?? [];

    if (kind === "uc3_conjunction" && operatorIds.length !== 2) {
      throw new Error("UC3 swarm requires exactly 2 operatorIds in baseSeed");
    }
    if (kind === "uc1_operator_behavior" && operatorIds.length < 1) {
      throw new Error("UC1 swarm requires at least 1 operatorId in baseSeed");
    }
    if (kind === "uc_pc_estimator") {
      if (baseSeed.pcEstimatorTarget == null) {
        throw new Error(
          "UC_PC_ESTIMATOR swarm requires baseSeed.pcEstimatorTarget (conjunction_event.id)",
        );
      }
    }
    if (kind === "uc_telemetry_inference") {
      if (operatorIds.length !== 1) {
        throw new Error(
          "UC_TELEMETRY swarm requires exactly 1 operatorId in baseSeed (the target satellite's operator)",
        );
      }
      if (baseSeed.telemetryTargetSatelliteId == null) {
        throw new Error(
          "UC_TELEMETRY swarm requires baseSeed.telemetryTargetSatelliteId",
        );
      }
    }
  }

  defaultMaxTurns(kind: string): number {
    return kind === "uc3_conjunction" ? 20 : 15;
  }
}

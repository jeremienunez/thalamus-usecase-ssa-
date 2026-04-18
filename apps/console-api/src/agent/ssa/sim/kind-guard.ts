/**
 * SsaKindGuard — SSA-supported sim kinds + per-kind invariants + maxTurns.
 *
 * Plan 2 · B.9. Lifted from packages/sweep/src/sim/swarm.service.ts
 * launchSwarm guards and the inline `maxTurns` default.
 */

import type { SimKindGuard } from "@interview/sweep";

const SSA_KINDS = new Set<string>([
  "uc1_operator_behavior",
  "uc3_conjunction",
  "uc_telemetry_inference",
  "uc_pc_estimator",
]);

export class SsaKindGuard implements SimKindGuard {
  validateLaunch(args: {
    kind: string;
    baseSeed: Record<string, unknown>;
  }): void {
    const { kind, baseSeed } = args;
    if (!SSA_KINDS.has(kind)) {
      throw new Error(`SsaKindGuard: unsupported sim kind "${kind}"`);
    }
    const subjectIds = (baseSeed.subjectIds as number[] | undefined) ?? [];

    if (kind === "uc3_conjunction" && subjectIds.length !== 2) {
      throw new Error("UC3 swarm requires exactly 2 subjectIds in baseSeed");
    }
    if (kind === "uc1_operator_behavior" && subjectIds.length < 1) {
      throw new Error("UC1 swarm requires at least 1 subjectId in baseSeed");
    }
    if (kind === "uc_pc_estimator") {
      if (baseSeed.pcEstimatorTarget == null) {
        throw new Error(
          "UC_PC_ESTIMATOR swarm requires baseSeed.pcEstimatorTarget (conjunction_event.id)",
        );
      }
    }
    if (kind === "uc_telemetry_inference") {
      if (subjectIds.length !== 1) {
        throw new Error(
          "UC_TELEMETRY swarm requires exactly 1 subjectId in baseSeed",
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

  driverForKind(kind: string): {
    runner: "sequential" | "dag";
    singleTurn: boolean;
  } {
    switch (kind) {
      case "uc3_conjunction":
        return { runner: "sequential", singleTurn: false };
      case "uc_telemetry_inference":
      case "uc_pc_estimator":
        return { runner: "dag", singleTurn: true };
      default:
        return { runner: "dag", singleTurn: false };
    }
  }
}

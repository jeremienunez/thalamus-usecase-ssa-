/**
 * SsaCortexSelector — picks the SSA skill name per turn.
 *
 * Plan 2 · B.4. Replaces DEFAULT_CORTEX_NAME / TELEMETRY_CORTEX_NAME /
 * PC_ESTIMATOR_CORTEX_NAME constants that lived in turn-runner-dag.ts +
 * turn-runner-sequential.ts. Dispatch:
 *
 *   pc sim kind or hints.hasPcEstimatorTarget                 → "pc_estimator_agent"
 *   telemetry sim kind or hints.hasTelemetryTarget (and not Pc) → "telemetry_inference_agent"
 *   otherwise                                                  → "sim_operator_agent"
 */

import type {
  CortexSelectionInput,
  SimCortexSelector,
} from "@interview/sweep";

const DEFAULT_CORTEX_NAME = "sim_operator_agent";
const TELEMETRY_CORTEX_NAME = "telemetry_inference_agent";
const PC_ESTIMATOR_CORTEX_NAME = "pc_estimator_agent";

export class SsaCortexSelector implements SimCortexSelector {
  pickCortexName(input: CortexSelectionInput): string {
    const hints = input.hints ?? {};
    const simKind = input.simKind;
    if (isPcEstimatorKind(simKind) || hints.hasPcEstimatorTarget) {
      return PC_ESTIMATOR_CORTEX_NAME;
    }
    if (isTelemetryKind(simKind) || hints.hasTelemetryTarget) {
      return TELEMETRY_CORTEX_NAME;
    }
    return DEFAULT_CORTEX_NAME;
  }
}

function isTelemetryKind(simKind: string): boolean {
  return simKind === "uc_telemetry_inference" || simKind === "telemetry";
}

function isPcEstimatorKind(simKind: string): boolean {
  return simKind === "uc_pc_estimator" || simKind === "pc";
}

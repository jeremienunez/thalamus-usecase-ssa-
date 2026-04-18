/**
 * SsaCortexSelector — picks the SSA skill name per turn.
 *
 * Plan 2 · B.4. Replaces DEFAULT_CORTEX_NAME / TELEMETRY_CORTEX_NAME /
 * PC_ESTIMATOR_CORTEX_NAME constants that lived in turn-runner-dag.ts +
 * turn-runner-sequential.ts. Dispatch:
 *
 *   hints.hasPcEstimatorTarget          → "pc_estimator_agent"
 *   hints.hasTelemetryTarget (and not Pc) → "telemetry_inference_agent"
 *   otherwise                            → "sim_operator_agent"
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
    if (hints.hasPcEstimatorTarget) return PC_ESTIMATOR_CORTEX_NAME;
    if (hints.hasTelemetryTarget) return TELEMETRY_CORTEX_NAME;
    return DEFAULT_CORTEX_NAME;
  }
}

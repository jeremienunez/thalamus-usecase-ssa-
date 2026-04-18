/**
 * LegacySsaCortexSelector — fallback SimCortexSelector.
 *
 * Same dispatch as apps/console-api/.../cortex-selector.ts. Deleted at
 * Plan 2 Étape 4.
 */

import type {
  CortexSelectionInput,
  SimCortexSelector,
} from "./ports";

const DEFAULT_CORTEX_NAME = "sim_operator_agent";
const TELEMETRY_CORTEX_NAME = "telemetry_inference_agent";
const PC_ESTIMATOR_CORTEX_NAME = "pc_estimator_agent";

export class LegacySsaCortexSelector implements SimCortexSelector {
  pickCortexName(input: CortexSelectionInput): string {
    const hints = input.hints ?? {};
    if (hints.hasPcEstimatorTarget) return PC_ESTIMATOR_CORTEX_NAME;
    if (hints.hasTelemetryTarget) return TELEMETRY_CORTEX_NAME;
    return DEFAULT_CORTEX_NAME;
  }
}

/**
 * SsaCortexSelector — picks the SSA skill name per turn.
 *
 * TODO(Plan 2 · B.4): replace DEFAULT_CORTEX_NAME / TELEMETRY_CORTEX_NAME /
 *   PC_ESTIMATOR_CORTEX_NAME constants in turn-runner-dag.ts:42-46. Dispatch:
 *
 *     simKind === "uc_telemetry_inference" → "telemetry_infer"
 *     simKind === "uc_pc_estimator"         → "pc_estimator"
 *     otherwise                             → "sim_operator_agent"
 */

import type {
  SimCortexSelector,
  CortexSelectionInput,
} from "@interview/sweep";

export class SsaCortexSelector implements SimCortexSelector {
  pickCortexName(_input: CortexSelectionInput): string {
    // TODO(B.4): implement dispatch.
    throw new Error("SsaCortexSelector.pickCortexName: TODO Plan 2 · B.4");
  }
}

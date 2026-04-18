/**
 * SimCortexSelector — kernel ↔ pack contract for per-turn skill selection.
 *
 * The pack decides which cortex/skill name to load per turn based on the swarm
 * kind (SSA: sim_operator_agent / telemetry_infer / pc_estimator). Replaces
 * the hard-coded DEFAULT_CORTEX_NAME + TELEMETRY_CORTEX_NAME + PC_ESTIMATOR_CORTEX_NAME
 * constants from turn-runner-dag.ts.
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.4 (impl).
 */

export interface CortexSelectionInput {
  simKind: string;
  turnIndex: number;
  /** Pack-defined hints — e.g. action-kind of previous turn, mode flags. */
  hints?: Record<string, unknown>;
}

export interface SimCortexSelector {
  /** Returns a skill name the CortexRegistry can resolve. */
  pickCortexName(input: CortexSelectionInput): string;
}

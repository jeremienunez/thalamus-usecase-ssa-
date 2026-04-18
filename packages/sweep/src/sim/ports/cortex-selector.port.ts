/**
 * SimCortexSelector — kernel ↔ pack contract for per-turn skill selection.
 *
 * The pack decides which cortex/skill name to load per turn based on the swarm
 * kind. The kernel just asks for a skill name.
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

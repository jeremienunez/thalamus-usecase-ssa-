/**
 * SimKindGuard — kernel ↔ pack contract for swarm kind validation.
 *
 * SwarmService + swarm-aggregate worker need to (a) reject unknown sim kinds
 * at launch time and (b) compute the default maxTurns per kind.
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.9 (impl).
 */

export interface SimKindGuard {
  /**
   * Throws if the kind is not supported by the pack OR the baseSeed
   * doesn't satisfy the pack's per-kind invariants.
   */
  validateLaunch(args: {
    kind: string;
    baseSeed: Record<string, unknown>;
  }): void;
  /** Per-kind default maxTurns (clamped by caller). */
  defaultMaxTurns(kind: string): number;
  driverForKind(kind: string): {
    runner: "sequential" | "dag";
    singleTurn: boolean;
  };
}

/**
 * SimKindGuard — kernel ↔ pack contract for swarm kind validation.
 *
 * SwarmService + swarm-aggregate worker need to (a) reject unknown sim kinds
 * at launch time, (b) compute the default maxTurns per kind. Both rules are
 * domain-shaped. Replaces the hard-coded `kind === "uc3_conjunction"`
 * branches in swarm.service.ts.
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.9 (impl).
 */

export interface SimKindGuard {
  /**
   * Throws if the kind is not supported by the pack OR the baseSeed
   * doesn't satisfy the pack's per-kind invariants (e.g. SSA UC3 needs
   * exactly 2 operatorIds, pc_estimator needs a conjunction id).
   */
  validateLaunch(args: {
    kind: string;
    baseSeed: Record<string, unknown>;
  }): void;
  /** Per-kind default maxTurns (clamped by caller). */
  defaultMaxTurns(kind: string): number;
}

/**
 * SimTurnTargetProvider — kernel ↔ pack contract for per-fish turn targets.
 *
 * Some swarm kinds attach a domain-specific "target bag" to every turn
 * prompt: SSA UC_TELEMETRY_INFERENCE → satellite + bus datasheet prior;
 * SSA UC_PC_ESTIMATOR → conjunction + covariance bounds. The pack decides
 * what fields ship and how to load them.
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.2 (impl fuses
 * load-telemetry-target + load-pc-target in apps/console-api).
 */

export interface SimTurnTargetProvider {
  loadTargets(args: {
    simRunId: number;
    /** Opaque seed hints (e.g. satelliteId, conjunctionId). Pack interprets. */
    seedHints: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

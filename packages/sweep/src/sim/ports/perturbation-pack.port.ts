/**
 * SimPerturbationPack — kernel ↔ pack contract for per-fish perturbation
 * generators + god-event templates.
 *
 * Each sim swarm kind (SSA UC1 debris breakup / UC3 conjunction / etc.)
 * ships its own family of PerturbationSpec generators + the canonical
 * GOD_EVENT_TEMPLATES used by extractGodEvents at turn 0. The kernel stays
 * pack-agnostic; only the RNG is kernel-owned.
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.6 (impl lifts uc1Generators +
 * uc3Generators + GOD_EVENT_TEMPLATES to apps/console-api).
 */

/**
 * Opaque spec — pack-shaped. Kernel stores it in sim_run.perturbation_spec
 * and re-hydrates for deterministic replays.
 */
export type GenericPerturbationSpec = Record<string, unknown>;

export interface GenericGodEvent {
  kind: string;
  summary: string;
  detail?: string;
  /** Opaque — pack may carry targetSatelliteId, targetOperatorId, etc. */
  targets?: Record<string, unknown>;
}

export interface SimPerturbationPack {
  /**
   * Deterministic per-kind generator set. Kernel seeds the RNG; pack returns
   * an array of specs of length K for a K-fish swarm.
   */
  generateSet(args: {
    simKind: string;
    baseSeed: Record<string, unknown>;
    count: number;
    rng: () => number;
  }): GenericPerturbationSpec[];

  /**
   * Extract the god-events carried by a PerturbationSpec (for UC1-style
   * god-event-first injection at turn 0).
   */
  extractGodEvents(spec: GenericPerturbationSpec): GenericGodEvent[];
}

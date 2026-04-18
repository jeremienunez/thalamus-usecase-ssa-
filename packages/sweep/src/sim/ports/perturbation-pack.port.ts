/**
 * SimPerturbationPack — kernel ↔ pack contract for per-fish perturbation
 * generators + god-event templates.
 *
 * Each sim swarm kind ships its own family of perturbation generators plus
 * any canonical turn-zero events. The kernel stays pack-agnostic; only the
 * RNG is kernel-owned.
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.6 (impl lifts pack logic out of
 * the kernel).
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
  /** Opaque pack-owned event metadata. */
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

  applyToSeed(args: {
    baseSeed: Record<string, unknown>;
    spec: GenericPerturbationSpec;
  }): Record<string, unknown>;

  agentHints(spec: GenericPerturbationSpec): {
    subjectHintsByIndex: Map<number, Record<string, unknown>>;
  };

  /**
   * Extract turn-zero events carried by a perturbation spec.
   */
  extractGodEvents(spec: GenericPerturbationSpec): GenericGodEvent[];
}

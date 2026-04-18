/**
 * SsaPerturbationPack — SSA per-kind perturbation generators + god templates.
 *
 * TODO(Plan 2 · B.6): lift from packages/sweep/src/sim/perturbation.ts:
 *     - uc1Generators (debris breakup)
 *     - uc3Generators (conjunction)
 *     - GOD_EVENT_TEMPLATES (move from god-channel.service.ts)
 *     - extractGodEvents(spec)
 *
 * Kernel perturbation.ts keeps only rngFromSeed (Mulberry32) +
 * applyPerturbation(seed, spec, pack) wrapper.
 */

import type {
  SimPerturbationPack,
  GenericPerturbationSpec,
  GenericGodEvent,
} from "@interview/sweep";

export class SsaPerturbationPack implements SimPerturbationPack {
  generateSet(_args: {
    simKind: string;
    baseSeed: Record<string, unknown>;
    count: number;
    rng: () => number;
  }): GenericPerturbationSpec[] {
    // TODO(B.6): dispatch uc1Generators / uc3Generators by simKind.
    throw new Error("SsaPerturbationPack.generateSet: TODO Plan 2 · B.6");
  }

  extractGodEvents(_spec: GenericPerturbationSpec): GenericGodEvent[] {
    // TODO(B.6): replay spec.godEvents + GOD_EVENT_TEMPLATES lookups.
    throw new Error("SsaPerturbationPack.extractGodEvents: TODO Plan 2 · B.6");
  }
}

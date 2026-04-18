/**
 * Deterministic RNG for sim kernel.
 *
 * Plan 2 · B.6: uc1Generators + uc3Generators + generateDefaultPerturbations
 * moved to the pack (SimPerturbationPack.generateSet). Kernel keeps only the
 * Mulberry32 RNG and the pure `applyPerturbation` seed transform — both are
 * domain-agnostic.
 *
 * Determinism invariant: (baseSeed, spec) → applied seed is pure; same
 * inputs always yield byte-identical output.
 */

import type { PerturbationSpec, SeedRefs } from "./types";

// -----------------------------------------------------------------------
// Seeded RNG — Mulberry32, deterministic and dependency-free.
// -----------------------------------------------------------------------

export interface Rng {
  next(): number; // [0, 1)
  int(maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
}

export function rngFromSeed(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max) => Math.floor(next() * max),
    pick: <T>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
  };
}

// -----------------------------------------------------------------------
// applyPerturbation — pure seed transform. Only pc_assumptions mutates
// meaningfully; other kinds are seed-preserving (side-effects handled by
// agent-build time + god-event injection via SimPerturbationPack).
// -----------------------------------------------------------------------

export function applyPerturbation(base: SeedRefs, spec: PerturbationSpec): SeedRefs {
  switch (spec.kind) {
    case "pc_assumptions":
      return {
        ...base,
        pcAssumptions: {
          hardBodyRadiusMeters: spec.hardBodyRadiusMeters,
          covarianceScale: spec.covarianceScale,
        },
      };
    default:
      return { ...base };
  }
}

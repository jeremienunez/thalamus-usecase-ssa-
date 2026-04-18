/**
 * Deterministic RNG for the sim kernel.
 */

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

export function applyPerturbation(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...base,
    ...patch,
  };
}

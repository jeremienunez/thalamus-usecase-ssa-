/**
 * Perturbation — apply a PerturbationSpec to a base seed, and generate a
 * default set of K specs for each swarm kind.
 *
 * Determinism invariant: (baseSeed, spec) -> applied seed is pure; same
 * inputs always yield byte-identical output. generateDefaultPerturbations
 * draws from a seeded RNG so the set is reproducible across runs.
 */

import type { PerturbationSpec, SeedRefs, SimKind } from "./types";

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
// Apply — pure function (base, spec) -> applied seed
// -----------------------------------------------------------------------

/**
 * Apply a perturbation spec to the base seed. Only launch_surge and
 * god_event actually mutate the seed semantically (via seededGod events
 * the orchestrator injects at turn 0); persona_tweak / constraint_override /
 * delta_v_budget are applied at agent-build time (see
 * sim-orchestrator.projectAgentPerturbations).
 *
 * Returns a new SeedRefs; does NOT mutate the input.
 */
export function applyPerturbation(base: SeedRefs, spec: PerturbationSpec): SeedRefs {
  switch (spec.kind) {
    case "noop":
      return { ...base };
    case "god_event":
      return { ...base };
    case "constraint_override":
    case "persona_tweak":
    case "delta_v_budget":
      return { ...base };
    case "launch_surge":
      // Surface the surge in the seed so downstream readers (reporter) can
      // cite it. It is also pushed as a god event by the orchestrator.
      return { ...base };
    case "pc_assumptions":
      return {
        ...base,
        pcAssumptions: {
          hardBodyRadiusMeters: spec.hardBodyRadiusMeters,
          covarianceScale: spec.covarianceScale,
        },
      };
    default: {
      const _exhaustive: never = spec;
      void _exhaustive;
      return { ...base };
    }
  }
}

// -----------------------------------------------------------------------
// Default perturbation sets — produce K specs deterministically
// -----------------------------------------------------------------------

/**
 * Produce a balanced set of K perturbations for a swarm kind. The first
 * spec is always `noop` (baseline control). The rest are distributed
 * across the available generators using the provided RNG.
 */
export function generateDefaultPerturbations(
  kind: SimKind,
  size: number,
  rng: Rng,
  opts: {
    agentCount: number;
    knownRegimeIds?: number[];
    candidateSatelliteIds?: number[];
    candidateOperatorIds?: number[];
  },
): PerturbationSpec[] {
  if (size < 1) throw new Error("perturbation set size must be >= 1");
  const out: PerturbationSpec[] = [{ kind: "noop" }];
  if (size === 1) return out;

  const generators: Array<() => PerturbationSpec> =
    kind === "uc3_conjunction"
      ? uc3Generators(rng, opts)
      : uc1Generators(rng, opts);

  for (let i = 1; i < size; i++) {
    const g = generators[i % generators.length];
    out.push(g());
  }
  return out;
}

// -----------------------------------------------------------------------
// Generator pools
// -----------------------------------------------------------------------

function uc3Generators(
  rng: Rng,
  opts: {
    agentCount: number;
    candidateSatelliteIds?: number[];
    candidateOperatorIds?: number[];
  },
): Array<() => PerturbationSpec> {
  const agentIndexes = () => rng.int(Math.max(1, opts.agentCount));
  return [
    // Delta-v budget squeeze on a random party.
    () => ({
      kind: "delta_v_budget",
      agentIndex: agentIndexes(),
      maxPerSat: rng.pick([10, 20, 40, 80, 150]),
    }),
    // Persona flip.
    () => ({
      kind: "persona_tweak",
      agentIndex: agentIndexes(),
      riskProfile: rng.pick(["conservative", "balanced", "aggressive"] as const),
    }),
    // Constraint override — insurance loss assumption.
    () => ({
      kind: "constraint_override",
      agentIndex: agentIndexes(),
      overrides: {
        insuranceLossUsd: rng.pick([5_000_000, 25_000_000, 100_000_000]),
        coverageTier: rng.pick(["basic", "standard", "premium"]),
      },
    }),
    // Sparse god event: sudden regulatory pressure.
    () => ({
      kind: "god_event",
      event: {
        kind: "regulation",
        summary:
          "Regulator issues 24h maneuver deadline: parties failing to decide face licence review.",
        detail:
          "A binding advisory compresses the decision window. Operators must converge within 24h or escalate to the reviewer.",
        targetOperatorId: pickOrUndef(rng, opts.candidateOperatorIds),
      },
    }),
    // Sparse god event: ASAT tension.
    () => ({
      kind: "god_event",
      event: {
        kind: "asat_event",
        summary: "Background ASAT test raises ambient debris risk in the conjunction shell.",
        detail:
          "A recent kinetic event has elevated baseline conjunction probabilities in neighbouring shells, compressing schedule buffers.",
        targetSatelliteId: pickOrUndef(rng, opts.candidateSatelliteIds),
      },
    }),
  ];
}

function uc1Generators(
  rng: Rng,
  opts: {
    agentCount: number;
    knownRegimeIds?: number[];
    candidateSatelliteIds?: number[];
    candidateOperatorIds?: number[];
  },
): Array<() => PerturbationSpec> {
  const agentIndexes = () => rng.int(Math.max(1, opts.agentCount));
  return [
    () => ({
      kind: "persona_tweak",
      agentIndex: agentIndexes(),
      riskProfile: rng.pick(["conservative", "balanced", "aggressive"] as const),
    }),
    () => ({
      kind: "launch_surge",
      regimeId: rng.pick(opts.knownRegimeIds?.length ? opts.knownRegimeIds : [1]),
      extraSatellites: rng.pick([20, 50, 100, 200]),
    }),
    () => ({
      kind: "god_event",
      event: {
        kind: "asat_event",
        summary: "Kinetic ASAT test creates a debris cloud; operators re-evaluate maneuver reserves.",
        detail:
          "The fragmented target raises conjunction rates in adjacent shells for weeks. Maneuver-reserve doctrine is revisited.",
        targetSatelliteId: pickOrUndef(rng, opts.candidateSatelliteIds),
      },
    }),
    () => ({
      kind: "god_event",
      event: {
        kind: "regulation",
        summary: "New regulation limits same-regime slot density; operators review deployment plans.",
        detail:
          "The regulator caps per-regime slot density, forcing operators to choose between deferring launches or paying slot fees.",
        targetOperatorId: pickOrUndef(rng, opts.candidateOperatorIds),
      },
    }),
    () => ({
      kind: "god_event",
      event: {
        kind: "debris_cascade",
        summary: "Secondary collision signals an emerging Kessler regime in the primary shell.",
        detail:
          "A follow-on collision has produced a second-generation debris population, degrading tracking and tightening operational margins.",
      },
    }),
    () => ({
      kind: "constraint_override",
      agentIndex: agentIndexes(),
      overrides: {
        insuranceLossUsd: rng.pick([10_000_000, 50_000_000, 200_000_000]),
      },
    }),
  ];
}

function pickOrUndef<T>(rng: Rng, arr?: readonly T[]): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return rng.pick(arr);
}

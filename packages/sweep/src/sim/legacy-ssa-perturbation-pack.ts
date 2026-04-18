/**
 * LegacySsaPerturbationPack + GOD_EVENT_TEMPLATES (sweep-side fallback).
 *
 * Plan 2 · B.6. Mirror of apps/console-api/src/agent/ssa/sim/perturbation-pack.ts.
 * Used when buildSweepContainer is called without opts.sim.perturbationPack.
 *
 * GOD_EVENT_TEMPLATES is re-exported from here so god-channel.service.ts
 * (still kernel-resident until B.6.5/C.2) keeps compiling until it moves.
 *
 * Deleted at Plan 2 Étape 4.
 */

import type {
  GenericGodEvent,
  GenericPerturbationSpec,
  SimPerturbationPack,
} from "./ports";

type SsaPerturbationSpec =
  | { kind: "noop" }
  | {
      kind: "god_event";
      event: {
        kind: "regulation" | "asat_event" | "launch_surge" | "debris_cascade" | "custom";
        summary: string;
        detail?: string;
        targetSatelliteId?: number;
        targetOperatorId?: number;
      };
    }
  | {
      kind: "constraint_override";
      agentIndex: number;
      overrides: Record<string, unknown>;
    }
  | {
      kind: "persona_tweak";
      agentIndex: number;
      riskProfile: "conservative" | "balanced" | "aggressive";
    }
  | { kind: "launch_surge"; regimeId: number; extraSatellites: number }
  | { kind: "delta_v_budget"; agentIndex: number; maxPerSat: number }
  | {
      kind: "pc_assumptions";
      hardBodyRadiusMeters: number;
      covarianceScale: "tight" | "nominal" | "loose";
    };

export const GOD_EVENT_TEMPLATES: Record<
  string,
  {
    kind: "regulation" | "asat_event" | "launch_surge" | "debris_cascade" | "custom";
    summaryTemplate: string;
    detail?: string;
  }
> = {
  asat_sample: {
    kind: "asat_event",
    summaryTemplate:
      "Kinetic ASAT test fragments {target} — debris cloud rises across LEO shells; tracking advisories broadcast.",
    detail:
      "A kinetic anti-satellite test has fragmented the target satellite. Operators in adjacent orbital shells face elevated conjunction rates for the coming weeks. Debris models are being updated by tracking networks.",
  },
  regulation_sample: {
    kind: "regulation",
    summaryTemplate:
      "New regulation effective {target}: operators must maneuver within 24h of high-probability conjunction alerts or face licence review.",
    detail:
      "A regulator has issued a binding rule compressing the maneuver-decision window. Operators who fail to act within 24h of high-probability conjunction alerts may face licence review, fines, or operational suspension.",
  },
  launch_surge_sample: {
    kind: "launch_surge",
    summaryTemplate:
      "Unexpected launch surge: +{target} satellites deploying to the primary commercial regime over the next 30 days.",
    detail:
      "A constellation operator has accelerated its deployment schedule. The primary regime will see a concentrated influx of new satellites, tightening slot availability and raising baseline conjunction rates.",
  },
  debris_cascade_sample: {
    kind: "debris_cascade",
    summaryTemplate:
      "Secondary collision in {target}: initial debris from previous event triggers a cascade — tracking coverage degraded.",
    detail:
      "A follow-on collision has produced a second-generation debris population. The cascade increases tracking uncertainty and forces a reassessment of maneuver thresholds fleet-wide.",
  },
};

export class LegacySsaPerturbationPack implements SimPerturbationPack {
  generateSet(args: {
    simKind: string;
    baseSeed: Record<string, unknown>;
    count: number;
    rng: () => number;
  }): GenericPerturbationSpec[] {
    if (args.count < 1) throw new Error("perturbation set size must be >= 1");
    const rng = wrapRng(args.rng);
    const opts = readOpts(args.baseSeed);
    const out: SsaPerturbationSpec[] = [{ kind: "noop" }];
    if (args.count === 1) return out as GenericPerturbationSpec[];

    const generators =
      args.simKind === "uc3_conjunction"
        ? uc3Generators(rng, opts)
        : uc1Generators(rng, opts);

    for (let i = 1; i < args.count; i++) {
      const g = generators[i % generators.length];
      out.push(g());
    }
    return out as GenericPerturbationSpec[];
  }

  extractGodEvents(spec: GenericPerturbationSpec): GenericGodEvent[] {
    const p = spec as SsaPerturbationSpec;
    if (p.kind === "god_event") {
      return [
        {
          kind: p.event.kind,
          summary: p.event.summary,
          detail: p.event.detail,
          targets: {
            targetSatelliteId: p.event.targetSatelliteId,
            targetOperatorId: p.event.targetOperatorId,
          },
        },
      ];
    }
    if (p.kind === "launch_surge") {
      return [
        {
          kind: "launch_surge",
          summary: `Launch surge in regime ${p.regimeId}: +${p.extraSatellites} satellites expected`,
        },
      ];
    }
    return [];
  }
}

interface RngWrap {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
}

function wrapRng(next: () => number): RngWrap {
  return {
    next,
    int: (max) => Math.floor(next() * max),
    pick: <T>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
  };
}

interface GenOpts {
  agentCount: number;
  knownRegimeIds?: number[];
  candidateSatelliteIds?: number[];
  candidateOperatorIds?: number[];
}

function readOpts(baseSeed: Record<string, unknown>): GenOpts {
  return {
    agentCount: (baseSeed.agentCount as number | undefined) ?? 2,
    knownRegimeIds: baseSeed.knownRegimeIds as number[] | undefined,
    candidateSatelliteIds: baseSeed.candidateSatelliteIds as number[] | undefined,
    candidateOperatorIds: baseSeed.candidateOperatorIds as number[] | undefined,
  };
}

function uc3Generators(rng: RngWrap, opts: GenOpts): Array<() => SsaPerturbationSpec> {
  const agentIndexes = () => rng.int(Math.max(1, opts.agentCount));
  return [
    () => ({
      kind: "delta_v_budget",
      agentIndex: agentIndexes(),
      maxPerSat: rng.pick([10, 20, 40, 80, 150]),
    }),
    () => ({
      kind: "persona_tweak",
      agentIndex: agentIndexes(),
      riskProfile: rng.pick(["conservative", "balanced", "aggressive"] as const),
    }),
    () => ({
      kind: "constraint_override",
      agentIndex: agentIndexes(),
      overrides: {
        insuranceLossUsd: rng.pick([5_000_000, 25_000_000, 100_000_000]),
        coverageTier: rng.pick(["basic", "standard", "premium"]),
      },
    }),
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
    () => ({
      kind: "god_event",
      event: {
        kind: "asat_event",
        summary:
          "Background ASAT test raises ambient debris risk in the conjunction shell.",
        detail:
          "A recent kinetic event has elevated baseline conjunction probabilities in neighbouring shells, compressing schedule buffers.",
        targetSatelliteId: pickOrUndef(rng, opts.candidateSatelliteIds),
      },
    }),
  ];
}

function uc1Generators(rng: RngWrap, opts: GenOpts): Array<() => SsaPerturbationSpec> {
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
        summary:
          "Kinetic ASAT test creates a debris cloud; operators re-evaluate maneuver reserves.",
        detail:
          "The fragmented target raises conjunction rates in adjacent shells for weeks. Maneuver-reserve doctrine is revisited.",
        targetSatelliteId: pickOrUndef(rng, opts.candidateSatelliteIds),
      },
    }),
    () => ({
      kind: "god_event",
      event: {
        kind: "regulation",
        summary:
          "New regulation limits same-regime slot density; operators review deployment plans.",
        detail:
          "The regulator caps per-regime slot density, forcing operators to choose between deferring launches or paying slot fees.",
        targetOperatorId: pickOrUndef(rng, opts.candidateOperatorIds),
      },
    }),
    () => ({
      kind: "god_event",
      event: {
        kind: "debris_cascade",
        summary:
          "Secondary collision signals an emerging Kessler regime in the primary shell.",
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

function pickOrUndef<T>(rng: RngWrap, arr?: readonly T[]): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return rng.pick(arr);
}

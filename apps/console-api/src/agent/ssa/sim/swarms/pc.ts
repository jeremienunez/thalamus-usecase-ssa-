/**
 * Pc estimator swarm launcher — public entry point for UC_PC_ESTIMATOR.
 *
 * Given a conjunction_event.id + fish count, resolves the event + its two
 * satellites through console-api's repository/service layer, builds a
 * perturbation plan that varies (hard-body radius × covariance envelope)
 * across the K fish, and delegates to SwarmService.
 *
 * Mirrors telemetry-swarm.service.ts — same fan-out shape, different payload.
 */

import { createLogger, stepLog } from "@interview/shared/observability";
import type {
  ConjunctionWithSatellitesRow,
} from "../../../../types/conjunction.types";
import type {
  PerturbationSpec,
  SeedRefs,
  SwarmConfig,
} from "@interview/sweep";
import type { LaunchSwarmResult, SwarmService } from "@interview/sweep/internal";

const logger = createLogger("pc-swarm");

const DEFAULT_FISH_COUNT = 20;
const MAX_FISH_CONCURRENCY = 16;

const RADII_M = [5, 10, 20] as const;
const COV_SCALES = ["tight", "nominal", "loose"] as const;

export interface PcEstimatorSwarmOpts {
  conjunctionId: number;
  fishCount?: number;
  config?: Partial<SwarmConfig>;
  createdBy?: number;
}

export interface PcSwarmConjunctionReadPort {
  findByIdWithSatellites(
    conjunctionId: bigint,
  ): Promise<ConjunctionWithSatellitesRow | null>;
}

async function loadConjunctionMeta(
  conjunctionRepo: PcSwarmConjunctionReadPort,
  conjunctionId: number,
): Promise<{ primaryOperatorId: number | null } | null> {
  const row = await conjunctionRepo.findByIdWithSatellites(BigInt(conjunctionId));
  if (!row) return null;
  return {
    primaryOperatorId:
      row.primary.operatorId === null ? null : Number(row.primary.operatorId),
  };
}

/** Build K perturbations cycling through radius × covariance pairs. */
function buildPerturbations(fishCount: number): PerturbationSpec[] {
  const specs: PerturbationSpec[] = [];
  for (let i = 0; i < fishCount; i++) {
    const radius = RADII_M[i % RADII_M.length]!;
    const cov = COV_SCALES[Math.floor(i / RADII_M.length) % COV_SCALES.length]!;
    specs.push({
      kind: "pc_assumptions",
      hardBodyRadiusMeters: radius,
      covarianceScale: cov,
    });
  }
  return specs;
}

export async function startPcEstimatorSwarm(
  deps: {
    conjunctionRepo: PcSwarmConjunctionReadPort;
    swarmService: SwarmService;
  },
  opts: PcEstimatorSwarmOpts,
): Promise<LaunchSwarmResult & { conjunctionId: number }> {
  const fishCount = opts.fishCount ?? DEFAULT_FISH_COUNT;

  stepLog(logger, "swarm", "start", {
    kind: "uc_pc_estimator",
    conjunctionId: opts.conjunctionId,
    fishCount,
  });

  try {
    const meta = await loadConjunctionMeta(
      deps.conjunctionRepo,
      opts.conjunctionId,
    );
    if (!meta) {
      throw new Error(
        `Conjunction ${opts.conjunctionId} not found — cannot launch Pc estimator swarm`,
      );
    }

    const baseSeed: SeedRefs = {
      subjectIds: meta.primaryOperatorId != null ? [meta.primaryOperatorId] : [],
      subjectKind: "operator",
      pcEstimatorTarget: opts.conjunctionId,
    };

    const perturbations = buildPerturbations(fishCount);

    const cfg: SwarmConfig = {
      llmMode: opts.config?.llmMode ?? "cloud",
      quorumPct: opts.config?.quorumPct ?? 0.6,
      perFishTimeoutMs: opts.config?.perFishTimeoutMs ?? 60_000,
      fishConcurrency:
        opts.config?.fishConcurrency ?? Math.min(fishCount, MAX_FISH_CONCURRENCY),
      nanoModel: opts.config?.nanoModel ?? "gpt-5-nano",
      seed: opts.config?.seed ?? Math.floor(Math.random() * 1_000_000),
    };

    const title = `uc_pc_estimator:${opts.conjunctionId}`;
    const result = await deps.swarmService.launchSwarm({
      kind: "uc_pc_estimator",
      title,
      baseSeed,
      perturbations,
      config: cfg,
      createdBy: opts.createdBy,
    });

    logger.info(
      {
        swarmId: result.swarmId,
        conjunctionId: opts.conjunctionId,
        fishCount: result.fishCount,
      },
      "pc estimator swarm launched",
    );

    stepLog(logger, "swarm", "done", {
      swarmId: result.swarmId,
      conjunctionId: opts.conjunctionId,
      fishCount: result.fishCount,
    });

    return { ...result, conjunctionId: opts.conjunctionId };
  } catch (err) {
    stepLog(logger, "swarm", "error", {
      conjunctionId: opts.conjunctionId,
      err: (err as Error)?.message,
    });
    throw err;
  }
}

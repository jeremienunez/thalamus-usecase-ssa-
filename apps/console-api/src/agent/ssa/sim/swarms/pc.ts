/**
 * Pc estimator swarm launcher — public entry point for UC_PC_ESTIMATOR.
 *
 * Given a conjunction_event.id + fish count, resolves the event + its two
 * satellites, builds a perturbation plan that varies (hard-body radius ×
 * covariance envelope) across the K fish, and delegates to SwarmService.
 *
 * Mirrors telemetry-swarm.service.ts — same fan-out shape, different payload.
 */

import { sql } from "drizzle-orm";
import type { Database, SeedRefs, PerturbationSpec, SwarmConfig } from "@interview/db-schema";
import { createLogger, stepLog } from "@interview/shared/observability";
import type { SwarmService, LaunchSwarmResult } from "@interview/sweep";

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

async function loadConjunctionMeta(
  db: Database,
  conjunctionId: number,
): Promise<{ primaryOperatorId: number | null } | null> {
  const rows = await db.execute(sql`
    SELECT sp.operator_id::int AS p_op
    FROM conjunction_event ce
    LEFT JOIN satellite sp ON sp.id = ce.primary_satellite_id
    WHERE ce.id = ${BigInt(conjunctionId)}
    LIMIT 1
  `);
  const r = rows.rows[0] as { p_op: number | null } | undefined;
  if (!r) return null;
  return { primaryOperatorId: r.p_op };
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
  deps: { db: Database; swarmService: SwarmService },
  opts: PcEstimatorSwarmOpts,
): Promise<LaunchSwarmResult & { conjunctionId: number }> {
  const fishCount = opts.fishCount ?? DEFAULT_FISH_COUNT;

  stepLog(logger, "swarm", "start", {
    kind: "uc_pc_estimator",
    conjunctionId: opts.conjunctionId,
    fishCount,
  });

  try {
    const meta = await loadConjunctionMeta(deps.db, opts.conjunctionId);
    if (!meta) {
      throw new Error(
        `Conjunction ${opts.conjunctionId} not found — cannot launch Pc estimator swarm`,
      );
    }

    const baseSeed: SeedRefs = {
      operatorIds: meta.primaryOperatorId != null ? [meta.primaryOperatorId] : [],
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

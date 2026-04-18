/**
 * Pc aggregator — reduce K fish `estimate_pc` actions into a Pc distribution.
 *
 * Produces:
 *   - medianPc / sigmaPc / p5Pc / p95Pc across fish
 *   - dissent clusters keyed on (dominantMode, sorted(flags))
 *     Each cluster with ≥ 2 fish is surfaced with its Pc range and fish count.
 *   - a sweep_suggestion payload (kind: "pc_estimate") with severity derived
 *     from median (≥1e-3 → high, ≥1e-4 → medium, else info).
 *
 * Kept pure-function / DB-agnostic so the unit tests can feed action rows
 * directly. The sweep aggregator orchestrator reads the DB rows and calls
 * computePcAggregate(actions).
 */

import { sql } from "drizzle-orm";
import type { Database, TurnAction } from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("sim-pc-aggregator");

export type PcSeverity = "high" | "medium" | "info";

export interface PcCluster {
  mode: string;
  flags: string[];
  pcRange: [number, number];
  fishCount: number;
}

export interface PcAggregate {
  conjunctionId: number;
  medianPc: number;
  sigmaPc: number;
  p5Pc: number;
  p95Pc: number;
  fishCount: number;
  clusters: PcCluster[];
  samples: number[];
  severity: PcSeverity;
}

export interface PcSweepSuggestion {
  kind: "pc_estimate";
  payload: {
    conjunctionId: number;
    medianPc: number;
    sigmaPc: number;
    p5Pc: number;
    p95Pc: number;
    clusters: PcCluster[];
    fishCount: number;
    methodology: "swarm-pc-estimator";
  };
  severity: PcSeverity;
}

export function severityFromMedian(median: number): PcSeverity {
  if (median >= 1e-3) return "high";
  if (median >= 1e-4) return "medium";
  return "info";
}

/**
 * Pure aggregation over parsed estimate_pc actions. Null/invalid rows are
 * skipped; if zero valid samples remain, returns null.
 */
export function computePcAggregate(
  actions: TurnAction[],
  fallbackConjunctionId?: number,
): PcAggregate | null {
  const estimates = actions.filter(
    (a): a is Extract<TurnAction, { kind: "estimate_pc" }> =>
      a?.kind === "estimate_pc",
  );
  if (estimates.length === 0) return null;

  const samples = estimates.map((e) => e.pcEstimate).sort((a, b) => a - b);
  const median = percentile(samples, 0.5);
  const p5 = percentile(samples, 0.05);
  const p95 = percentile(samples, 0.95);
  const sigma = stddev(samples);

  // Cluster by (mode, sorted(flags)). Emit clusters with ≥ 2 fish.
  const clusterMap = new Map<
    string,
    { mode: string; flags: string[]; pcs: number[] }
  >();
  for (const e of estimates) {
    const flags = [...e.flags].sort();
    const key = `${e.dominantMode}|${flags.join(",")}`;
    const cur = clusterMap.get(key) ?? {
      mode: e.dominantMode,
      flags,
      pcs: [],
    };
    cur.pcs.push(e.pcEstimate);
    clusterMap.set(key, cur);
  }
  const clusters: PcCluster[] = [];
  for (const { mode, flags, pcs } of clusterMap.values()) {
    if (pcs.length < 2) continue;
    const sorted = [...pcs].sort((a, b) => a - b);
    clusters.push({
      mode,
      flags,
      pcRange: [sorted[0]!, sorted[sorted.length - 1]!],
      fishCount: pcs.length,
    });
  }
  clusters.sort((a, b) => b.fishCount - a.fishCount);

  const conjunctionId = estimates[0]!.conjunctionId ?? fallbackConjunctionId ?? 0;

  return {
    conjunctionId,
    medianPc: median,
    sigmaPc: sigma,
    p5Pc: p5,
    p95Pc: p95,
    fishCount: estimates.length,
    clusters,
    samples,
    severity: severityFromMedian(median),
  };
}

export function aggregateToSuggestion(agg: PcAggregate): PcSweepSuggestion {
  return {
    kind: "pc_estimate",
    severity: agg.severity,
    payload: {
      conjunctionId: agg.conjunctionId,
      medianPc: agg.medianPc,
      sigmaPc: agg.sigmaPc,
      p5Pc: agg.p5Pc,
      p95Pc: agg.p95Pc,
      clusters: agg.clusters,
      fishCount: agg.fishCount,
      methodology: "swarm-pc-estimator",
    },
  };
}

// -----------------------------------------------------------------------
// DB-backed orchestrator: read terminal sim_turn rows, aggregate, emit.
// -----------------------------------------------------------------------

export interface PcAggregatorDeps {
  db: Database;
}

export class PcAggregatorService {
  constructor(private readonly deps: PcAggregatorDeps) {}

  async aggregate(opts: {
    swarmId: number;
  }): Promise<{ aggregate: PcAggregate | null; suggestion: PcSweepSuggestion | null }> {
    const conjRow = await this.deps.db.execute(sql`
      SELECT base_seed FROM sim_swarm WHERE id = ${BigInt(opts.swarmId)} LIMIT 1
    `);
    const seed = (conjRow.rows[0] as { base_seed: { pcEstimatorTarget?: number } } | undefined)
      ?.base_seed;
    const conjunctionId = seed?.pcEstimatorTarget;

    const rows = await this.deps.db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (r.id)
          r.id AS sim_run_id, r.status AS run_status, t.action AS action
        FROM sim_run r
        LEFT JOIN sim_turn t
          ON t.sim_run_id = r.id AND t.actor_kind = 'agent'
        WHERE r.swarm_id = ${BigInt(opts.swarmId)}
        ORDER BY r.id, t.turn_index DESC NULLS LAST
      )
      SELECT * FROM latest
    `);

    const actions: TurnAction[] = [];
    for (const r of rows.rows as Array<{
      sim_run_id: string | number;
      run_status: string;
      action: TurnAction | null;
    }>) {
      if (r.run_status === "done" && r.action) actions.push(r.action);
    }

    const aggregate = computePcAggregate(actions, conjunctionId);
    if (!aggregate) {
      logger.warn({ swarmId: opts.swarmId }, "pc aggregator: no estimates");
      return { aggregate: null, suggestion: null };
    }

    const suggestion = aggregateToSuggestion(aggregate);
    logger.info(
      {
        swarmId: opts.swarmId,
        conjunctionId: aggregate.conjunctionId,
        medianPc: aggregate.medianPc,
        sigmaPc: aggregate.sigmaPc,
        clusters: aggregate.clusters.length,
        severity: aggregate.severity,
      },
      "pc aggregate complete",
    );
    return { aggregate, suggestion };
  }
}

// -----------------------------------------------------------------------
// Pure stat helpers
// -----------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance =
    arr.reduce((s, v) => s + (v - m) * (v - m), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

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

import { createLogger } from "@interview/shared/observability";
import {
  type SimSwarmStore,
} from "@interview/sweep";
import {
  percentile,
  sampleStddev,
} from "@interview/sweep/internal";
import type { SsaTurnAction } from "../action-schema";

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

interface PcEstimateAction {
  kind: "estimate_pc";
  conjunctionId: number;
  pcEstimate: number;
  dominantMode: string;
  flags: string[];
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
  actions: SsaTurnAction[],
  fallbackConjunctionId?: number,
): PcAggregate | null {
  const estimates = actions
    .filter((action): action is SsaTurnAction & { kind: "estimate_pc" } => {
      return action?.kind === "estimate_pc";
    })
    .map((action) => action as unknown as PcEstimateAction);
  if (estimates.length === 0) return null;

  const samples = estimates.map((e) => e.pcEstimate).sort((a, b) => a - b);
  const median = percentile(samples, 0.5);
  const p5 = percentile(samples, 0.05);
  const p95 = percentile(samples, 0.95);
  const sigma = sampleStddev(samples);

  // Cluster by (mode, sorted(flags)). Emit clusters with ≥ 2 fish.
  const clusterMap = new Map<
    string,
    { mode: string; flags: string[]; pcs: number[] }
  >();
  for (const e of estimates) {
    const flags = [...e.flags].sort();
    const key = `${e.dominantMode}|${flags.join(",")}`;
    const cur: { mode: string; flags: string[]; pcs: number[] } =
      clusterMap.get(key) ?? {
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
// App-backed orchestrator: read terminal turn rows via the sim store and aggregate.
// -----------------------------------------------------------------------

export interface PcAggregatorDeps {
  swarmStore: Pick<
    SimSwarmStore,
    "getSwarm" | "listTerminalActionsForSwarm"
  >;
}

export class PcAggregatorService {
  constructor(private readonly deps: PcAggregatorDeps) {}

  async aggregate(opts: {
    swarmId: number;
  }): Promise<{ aggregate: PcAggregate | null; suggestion: PcSweepSuggestion | null }> {
    const swarm = await this.deps.swarmStore.getSwarm(opts.swarmId);
    const conjunctionId =
      typeof (swarm?.baseSeed as Record<string, unknown> | undefined)
        ?.pcEstimatorTarget === "number"
        ? ((swarm!.baseSeed as Record<string, unknown>).pcEstimatorTarget as number)
        : undefined;
    const rows = await this.deps.swarmStore.listTerminalActionsForSwarm(
      opts.swarmId,
    );

    const actions: SsaTurnAction[] = [];
    for (const row of rows) {
      if (row.runStatus === "done" && row.action) {
        actions.push(row.action as SsaTurnAction);
      }
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

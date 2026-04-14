/**
 * Scalar aggregator — reduces K fish `infer_telemetry` actions into a
 * per-scalar consensus distribution (median, σ, min, max, n, values[]).
 *
 * Used by the telemetry-inference swarm flow. Distinct from the narrative
 * aggregator (aggregator.service.ts) which clusters on observableSummary
 * embeddings. Here the truth is numeric — we compute stats directly.
 */

import { sql } from "drizzle-orm";
import type { Database, TelemetryScalarKey, TurnAction } from "@interview/db-schema";
import { TELEMETRY_SCALAR_KEYS } from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("sim-telemetry-aggregator");

export interface TelemetryScalarStats {
  median: number;
  sigma: number;
  min: number;
  max: number;
  mean: number;
  n: number;
  values: number[];
  /** Unit reported by the majority of fish — used as the canonical unit. */
  unit: string;
  /** Per-fish self-reported confidences, averaged. */
  avgFishConfidence: number;
}

export interface TelemetryAggregate {
  swarmId: number;
  satelliteId: number;
  totalFish: number;
  succeededFish: number;
  failedFish: number;
  quorumMet: boolean;
  /** Only keys present in at least one successful fish are populated. */
  scalars: Partial<Record<TelemetryScalarKey, TelemetryScalarStats>>;
  /**
   * Swarm-level confidence for this inference. Computed from (n, σ/|median|)
   * and clamped to the SIM_UNCORROBORATED band [0.10, 0.35]. Field promotion
   * beyond OSINT_CORROBORATED requires real field data, enforced upstream
   * by ConfidenceService — not by this aggregator.
   */
  simConfidence: number;
}

export interface TelemetryAggregatorDeps {
  db: Database;
}

export class TelemetryAggregatorService {
  constructor(private readonly deps: TelemetryAggregatorDeps) {}

  async aggregate(opts: {
    swarmId: number;
    quorumPct?: number;
  }): Promise<TelemetryAggregate | null> {
    const quorumPct = opts.quorumPct ?? 0.8;

    const { size, satelliteId } = await this.loadSwarmMeta(opts.swarmId);
    if (satelliteId === null) {
      logger.warn(
        { swarmId: opts.swarmId },
        "telemetry aggregate: swarm has no target satelliteId in seed_refs",
      );
      return null;
    }

    const { done, failed, actions } = await this.loadTerminalActions(opts.swarmId);
    const quorumRequired = Math.ceil(size * quorumPct);
    const quorumMet = done >= quorumRequired;

    if (!quorumMet) {
      logger.warn(
        { swarmId: opts.swarmId, done, quorumRequired },
        "quorum not met; returning empty telemetry aggregate",
      );
      return {
        swarmId: opts.swarmId,
        satelliteId,
        totalFish: size,
        succeededFish: done,
        failedFish: failed,
        quorumMet: false,
        scalars: {},
        simConfidence: 0,
      };
    }

    // Collect per-scalar samples across successful fish.
    const samples: Partial<
      Record<TelemetryScalarKey, Array<{ value: number; unit: string; confidence: number }>>
    > = {};
    for (const a of actions) {
      if (a.kind !== "infer_telemetry") continue;
      for (const key of TELEMETRY_SCALAR_KEYS) {
        const s = a.scalars[key];
        if (!s) continue;
        const arr = samples[key] ?? [];
        arr.push({ value: s.value, unit: s.unit, confidence: a.confidence });
        samples[key] = arr;
      }
    }

    const scalars: Partial<Record<TelemetryScalarKey, TelemetryScalarStats>> = {};
    let totalCv = 0;
    let scalarsCounted = 0;
    let totalConfidenceSum = 0;

    for (const key of TELEMETRY_SCALAR_KEYS) {
      const pts = samples[key];
      if (!pts || pts.length === 0) continue;
      const values = pts.map((p) => p.value).sort((a, b) => a - b);
      const median = percentile(values, 0.5);
      const mean = avg(values);
      const sigma = stddev(values, mean);
      const min = values[0];
      const max = values[values.length - 1];
      const unit = modeUnit(pts.map((p) => p.unit));
      const avgFishConfidence = avg(pts.map((p) => p.confidence));
      scalars[key] = {
        median,
        sigma,
        min,
        max,
        mean,
        n: values.length,
        values,
        unit,
        avgFishConfidence,
      };
      const denom = Math.abs(median) > 1e-9 ? Math.abs(median) : Math.max(1, max);
      totalCv += sigma / denom;
      totalConfidenceSum += avgFishConfidence;
      scalarsCounted++;
    }

    // Swarm confidence: starts at self-reported mean, penalised by dispersion.
    // Clamped to SIM_UNCORROBORATED band [0.10, 0.35] — we never exceed OSINT
    // without reviewer action.
    let simConfidence = 0;
    if (scalarsCounted > 0) {
      const meanFishConfidence = totalConfidenceSum / scalarsCounted;
      const meanCv = totalCv / scalarsCounted;
      // Penalty: each 10% CV docks 0.05.
      const penalty = Math.min(0.25, meanCv * 0.5);
      const raw = Math.max(0, meanFishConfidence - penalty);
      simConfidence = clamp(raw, 0.1, 0.35);
    }

    logger.info(
      {
        swarmId: opts.swarmId,
        satelliteId,
        totalFish: size,
        succeededFish: done,
        scalarsCounted,
        simConfidence: Number(simConfidence.toFixed(3)),
      },
      "telemetry aggregate complete",
    );

    return {
      swarmId: opts.swarmId,
      satelliteId,
      totalFish: size,
      succeededFish: done,
      failedFish: failed,
      quorumMet: true,
      scalars,
      simConfidence,
    };
  }

  // -------------------------------------------------------------------
  // Loaders
  // -------------------------------------------------------------------

  private async loadSwarmMeta(
    swarmId: number,
  ): Promise<{ size: number; satelliteId: number | null }> {
    const rows = await this.deps.db.execute(sql`
      SELECT size, base_seed FROM sim_swarm WHERE id = ${BigInt(swarmId)} LIMIT 1
    `);
    const row = rows.rows[0] as
      | {
          size: number;
          base_seed: { telemetryTargetSatelliteId?: number } | null;
        }
      | undefined;
    if (!row) return { size: 0, satelliteId: null };
    return {
      size: row.size,
      satelliteId: row.base_seed?.telemetryTargetSatelliteId ?? null,
    };
  }

  private async loadTerminalActions(
    swarmId: number,
  ): Promise<{
    done: number;
    failed: number;
    actions: TurnAction[];
  }> {
    // Pick the last agent turn per fish, collect its action JSONB.
    const rows = await this.deps.db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (r.id)
          r.id         AS sim_run_id,
          r.status     AS run_status,
          t.action     AS action
        FROM sim_run r
        LEFT JOIN sim_turn t
          ON t.sim_run_id = r.id AND t.actor_kind = 'agent'
        WHERE r.swarm_id = ${BigInt(swarmId)}
        ORDER BY r.id, t.turn_index DESC NULLS LAST
      )
      SELECT * FROM latest
    `);

    const actions: TurnAction[] = [];
    let done = 0;
    let failed = 0;
    for (const r of rows.rows as Array<{
      sim_run_id: string | number;
      run_status: string;
      action: TurnAction | null;
    }>) {
      if (r.run_status === "done") {
        done++;
        if (r.action) actions.push(r.action);
      } else if (r.run_status === "failed") {
        failed++;
      }
    }
    return { done, failed, actions };
  }
}

// -----------------------------------------------------------------------
// Pure stat helpers
// -----------------------------------------------------------------------

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[], mean?: number): number {
  if (arr.length < 2) return 0;
  const m = mean ?? avg(arr);
  const variance =
    arr.reduce((s, v) => s + (v - m) * (v - m), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function modeUnit(units: string[]): string {
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u, (counts.get(u) ?? 0) + 1);
  let best = units[0] ?? "";
  let bestCount = 0;
  for (const [u, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      best = u;
    }
  }
  return best;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

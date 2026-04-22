import { createLogger } from "@interview/shared/observability";
import {
  type SimSwarmStore,
} from "@interview/sweep";
import {
  average,
  clamp,
  mostFrequent,
  percentile,
  sampleStddev,
} from "@interview/sweep/internal";
import {
  type SsaTurnAction,
} from "../action-schema";
import {
  TELEMETRY_SCALAR_KEYS,
  type TelemetryScalarKey,
} from "../../../../types/sim-telemetry.types";

const logger = createLogger("ssa-telemetry-aggregator");

export interface TelemetryScalarStats {
  median: number;
  sigma: number;
  min: number;
  max: number;
  mean: number;
  n: number;
  values: number[];
  unit: string;
  avgFishConfidence: number;
}

export interface TelemetryAggregate {
  swarmId: number;
  satelliteId: number;
  totalFish: number;
  succeededFish: number;
  failedFish: number;
  quorumMet: boolean;
  scalars: Partial<Record<TelemetryScalarKey, TelemetryScalarStats>>;
  simConfidence: number;
}

export interface TelemetryAggregatorDeps {
  swarmStore: Pick<
    SimSwarmStore,
    "getSwarm" | "listTerminalActionsForSwarm"
  >;
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
        "telemetry aggregate: swarm has no target satelliteId in base seed",
      );
      return null;
    }

    const { done, failed, actions } = await this.loadTerminalActions(opts.swarmId);
    const quorumRequired = Math.ceil(size * quorumPct);
    const quorumMet = done >= quorumRequired;

    if (!quorumMet) {
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

    const samples: Partial<
      Record<TelemetryScalarKey, Array<{ value: number; unit: string; confidence: number }>>
    > = {};
    for (const action of actions) {
      if (action.kind !== "infer_telemetry") continue;
      for (const key of TELEMETRY_SCALAR_KEYS) {
        const scalar = action.scalars[key];
        if (!scalar) continue;
        const arr = samples[key] ?? [];
        arr.push({
          value: scalar.value,
          unit: scalar.unit,
          confidence: action.confidence,
        });
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
      const values = pts.map((point) => point.value).sort((a, b) => a - b);
      const median = percentile(values, 0.5);
      const mean = average(values);
      const sigma = sampleStddev(values, mean);
      const min = values[0]!;
      const max = values[values.length - 1]!;
      const unit = mostFrequent(pts.map((point) => point.unit));
      const avgFishConfidence = average(pts.map((point) => point.confidence));
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

    let simConfidence = 0;
    if (scalarsCounted > 0) {
      const meanFishConfidence = totalConfidenceSum / scalarsCounted;
      const meanCv = totalCv / scalarsCounted;
      const penalty = Math.min(0.25, meanCv * 0.5);
      const raw = Math.max(0, meanFishConfidence - penalty);
      simConfidence = clamp(raw, 0.1, 0.35);
    }

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

  private async loadSwarmMeta(
    swarmId: number,
  ): Promise<{ size: number; satelliteId: number | null }> {
    const row = await this.deps.swarmStore.getSwarm(swarmId);
    if (!row) return { size: 0, satelliteId: null };
    const baseSeed = row.baseSeed as Record<string, unknown>;
    return {
      size: row.size,
      satelliteId:
        typeof baseSeed.telemetryTargetSatelliteId === "number"
          ? baseSeed.telemetryTargetSatelliteId
          : null,
    };
  }

  private async loadTerminalActions(
    swarmId: number,
  ): Promise<{
    done: number;
    failed: number;
    actions: SsaTurnAction[];
  }> {
    const rows = await this.deps.swarmStore.listTerminalActionsForSwarm(swarmId);

    const actions: SsaTurnAction[] = [];
    let done = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.runStatus === "done") {
        done++;
        if (row.action) actions.push(row.action as SsaTurnAction);
      } else if (row.runStatus === "failed") {
        failed++;
      }
    }
    return { done, failed, actions };
  }
}

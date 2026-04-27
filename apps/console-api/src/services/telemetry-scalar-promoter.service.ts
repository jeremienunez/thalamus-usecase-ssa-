import { createLogger, stepLog } from "@interview/shared/observability";
import type { TelemetryAggregate } from "../agent/ssa/sim/aggregators/telemetry";
import {
  round,
  scoreScalar,
  telemetryColumn,
} from "./sim-promotion-helpers";
import type {
  SimPromotionSatellitePort,
  SimPromotionSwarmPort,
  SimSuggestionWritePort,
} from "./sim-promotion.types";

const logger = createLogger("telemetry-scalar-promoter");

export interface TelemetryScalarPromoterDeps {
  sweepRepo: SimSuggestionWritePort;
  satelliteRepo: SimPromotionSatellitePort;
  swarmRepo: SimPromotionSwarmPort;
}

export class TelemetryScalarPromoter {
  constructor(private readonly deps: TelemetryScalarPromoterDeps) {}

  async emitTelemetrySuggestions(
    aggregate: TelemetryAggregate,
  ): Promise<number[]> {
    if (!aggregate.quorumMet) {
      stepLog(logger, "suggestion.emit", "done", {
        swarmId: aggregate.swarmId,
        emitted: false,
        reason: "telemetry quorum not met",
      });
      return [];
    }

    const sat = await this.deps.satelliteRepo.findByIdFull(
      BigInt(aggregate.satelliteId),
    );
    if (!sat) {
      stepLog(logger, "suggestion.emit", "done", {
        swarmId: aggregate.swarmId,
        emitted: false,
        reason: "target satellite not found",
        satelliteId: aggregate.satelliteId,
      });
      return [];
    }

    const nullColumns = await this.deps.satelliteRepo.findNullTelemetryColumns(
      BigInt(aggregate.satelliteId),
    );

    const suggestionIds: number[] = [];
    for (const [key, stats] of Object.entries(aggregate.scalars)) {
      if (!stats) continue;
      const column = telemetryColumn(key);
      if (column === null || !nullColumns.has(column)) continue;

      const { severity, sourceClass } = scoreScalar(
        { median: stats.median, sigma: stats.sigma, n: stats.n },
        aggregate.simConfidence,
      );
      const median = round(stats.median, 6);

      const simDistribution = JSON.stringify({
        swarmId: aggregate.swarmId,
        satelliteId: aggregate.satelliteId,
        scalar: key,
        column,
        stats: {
          median,
          mean: round(stats.mean, 6),
          sigma: round(stats.sigma, 6),
          min: round(stats.min, 6),
          max: round(stats.max, 6),
          n: stats.n,
          unit: stats.unit,
          avgFishConfidence: round(stats.avgFishConfidence, 4),
          values: stats.values.map((value) => round(value, 6)),
        },
        simConfidence: round(aggregate.simConfidence, 4),
        sourceClass,
      });

      const resolutionPayload = JSON.stringify({
        kind: "update_field",
        satelliteIds: [aggregate.satelliteId],
        field: column,
        value: median,
        provenance: {
          source: "sim_swarm_telemetry",
          swarmId: aggregate.swarmId,
          sourceClass,
        },
      });

      const suggestionId = await this.deps.sweepRepo.insertGeneric({
        domain: "ssa",
        domainFields: {
          operatorCountryId: sat.operatorCountryId,
          operatorCountryName: sat.operatorCountryName ?? "(no country)",
          category: "enrichment",
          severity,
          title: `Infer ${key} for ${sat.name} ~= ${round(stats.median, 3)} ${stats.unit}`,
          description: [
            `Multi-agent inference from bus datasheet prior + persona perturbations across ${stats.n} fish.`,
            "",
            `Median: ${round(stats.median, 3)} ${stats.unit} (sigma ${round(stats.sigma, 3)}, min ${round(stats.min, 3)}, max ${round(stats.max, 3)}).`,
            `Self-reported fish confidence: ${round(stats.avgFishConfidence, 2)}. Swarm confidence: ${round(aggregate.simConfidence, 2)}.`,
            "",
            `Source class: ${sourceClass}. This is an inference, not a measurement.`,
          ].join("\n"),
          affectedSatellites: 1,
          suggestedAction: `UPDATE satellite.${column} = ${median} ${stats.unit}`,
          webEvidence: null,
        },
        resolutionPayload,
        simSwarmId: String(aggregate.swarmId),
        simDistribution,
      });
      suggestionIds.push(Number(suggestionId));
    }

    if (suggestionIds.length > 0) {
      await this.deps.swarmRepo.linkOutcome(BigInt(aggregate.swarmId), {
        suggestionId: BigInt(suggestionIds[0]!),
      });
    }

    stepLog(logger, "suggestion.emit", "done", {
      swarmId: aggregate.swarmId,
      emitted: suggestionIds.length > 0,
      suggestionCount: suggestionIds.length,
      suggestionIds,
      satelliteId: aggregate.satelliteId,
    });
    return suggestionIds;
  }
}

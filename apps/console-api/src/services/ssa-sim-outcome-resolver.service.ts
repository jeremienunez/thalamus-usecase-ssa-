import type {
  AggregatorService,
  SimOutcomeResolver,
  SimResolvedOutcome,
  SwarmAggregate,
} from "@interview/sweep";
import type { PcAggregatorService } from "../agent/ssa/sim/aggregators/pc";
import type {
  TelemetryAggregate,
  TelemetryAggregatorService,
} from "../agent/ssa/sim/aggregators/telemetry";
import type { SimPromotionService } from "./sim-promotion.service";

const MODAL_SUGGESTION_THRESHOLD = 0.5;

export interface SsaSimOutcomeResolverDeps {
  aggregator: Pick<AggregatorService, "aggregate">;
  telemetryAggregator: Pick<TelemetryAggregatorService, "aggregate">;
  pcAggregator: Pick<PcAggregatorService, "aggregate">;
  promotionService: Pick<
    SimPromotionService,
    "emitSuggestionFromModal" | "emitTelemetrySuggestions"
  >;
}

export class SsaSimOutcomeResolverService implements SimOutcomeResolver {
  constructor(private readonly deps: SsaSimOutcomeResolverDeps) {}

  async resolve(args: Parameters<SimOutcomeResolver["resolve"]>[0]): Promise<SimResolvedOutcome> {
    switch (args.swarm.kind) {
      case "uc_telemetry_inference":
        return await this.resolveTelemetry(args.swarmId);
      case "uc_pc_estimator":
        return await this.resolvePc(args.swarmId, args.swarm, args.terminals);
      default:
        return await this.resolveNarrative(args.swarmId);
    }
  }

  private async resolveNarrative(swarmId: number): Promise<SimResolvedOutcome> {
    const aggregate = await this.deps.aggregator.aggregate(swarmId);
    const status: "done" | "failed" = aggregate.quorumMet ? "done" : "failed";
    await this.emitNarrativeSuggestion(swarmId, aggregate);
    return {
      status,
      snapshotKey: "aggregate",
      snapshot: aggregate as unknown as Record<string, unknown>,
    };
  }

  private async resolveTelemetry(swarmId: number): Promise<SimResolvedOutcome> {
    const aggregate = await this.deps.telemetryAggregator.aggregate({ swarmId });
    if (!aggregate) {
      return { status: "failed" };
    }

    if (aggregate.quorumMet) {
      await this.deps.promotionService.emitTelemetrySuggestions(
        aggregate,
      );
    }

    return {
      status: aggregate.quorumMet ? "done" : "failed",
      snapshotKey: "telemetryAggregate",
      snapshot: aggregate as unknown as Record<string, unknown>,
    };
  }

  private async resolvePc(
    swarmId: number,
    swarm: { size: number; config: Record<string, unknown> },
    terminals: Array<{ runStatus: string }>,
  ): Promise<SimResolvedOutcome> {
    const quorumPct =
      typeof swarm.config.quorumPct === "number" ? swarm.config.quorumPct : 0.8;
    const { aggregate } = await this.deps.pcAggregator.aggregate({ swarmId });
    const done = terminals.filter((row) => row.runStatus === "done").length;
    const quorumMet = done >= Math.ceil(swarm.size * quorumPct);
    const snapshot =
      aggregate && typeof aggregate === "object"
        ? ({
            ...(aggregate as unknown as Record<string, unknown>),
            quorumMet,
            succeededFish: done,
            failedFish: terminals.filter((row) => row.runStatus === "failed").length,
          } satisfies Record<string, unknown>)
        : null;

    return {
      status: quorumMet && snapshot ? "done" : "failed",
      ...(snapshot ? { snapshotKey: "pcAggregate", snapshot } : {}),
    };
  }

  private async emitNarrativeSuggestion(
    swarmId: number,
    aggregate: SwarmAggregate,
  ): Promise<void> {
    if (
      aggregate.modal === null ||
      aggregate.modal.fraction < MODAL_SUGGESTION_THRESHOLD ||
      !["accept", "maneuver"].includes(String(aggregate.modal.actionKind))
    ) {
      return;
    }
    await this.deps.promotionService.emitSuggestionFromModal(
      swarmId,
      aggregate,
    );
  }
}

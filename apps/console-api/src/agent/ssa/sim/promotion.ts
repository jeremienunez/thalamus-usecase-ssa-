import type {
  SimPromoteInput,
  SimPromoteResult,
  SimPromotionAdapter,
  SwarmAggregate,
} from "@interview/sweep";
import type { SimPromotionService } from "../../../services/sim-promotion.service";
import type { TelemetryAggregate } from "./aggregators/telemetry";

export interface SsaSimPromotionDeps {
  promotionService: Pick<SimPromotionService, "promote">;
}

export interface EmitSuggestionDeps {
  promotionService: Pick<SimPromotionService, "emitSuggestionFromModal">;
}

export interface EmitTelemetrySuggestionsDeps {
  promotionService: Pick<SimPromotionService, "emitTelemetrySuggestions">;
}

export class SsaSimPromotionAdapter implements SimPromotionAdapter {
  constructor(private readonly deps: SsaSimPromotionDeps) {}

  async promote(input: SimPromoteInput): Promise<SimPromoteResult> {
    return await this.deps.promotionService.promote(input);
  }
}

export async function emitSuggestionFromModal(
  deps: EmitSuggestionDeps,
  swarmId: number,
  aggregate: SwarmAggregate,
): Promise<number | null> {
  return await deps.promotionService.emitSuggestionFromModal(
    swarmId,
    aggregate,
  );
}

export async function emitTelemetrySuggestions(
  deps: EmitTelemetrySuggestionsDeps,
  aggregate: TelemetryAggregate,
): Promise<number[]> {
  return await deps.promotionService.emitTelemetrySuggestions(aggregate);
}

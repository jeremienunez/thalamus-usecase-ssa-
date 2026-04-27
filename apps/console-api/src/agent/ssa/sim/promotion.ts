import type {
  SimPromoteInput,
  SimPromoteResult,
  SimPromotionAdapter,
  SwarmAggregate,
} from "@interview/sweep";
import type { TelemetryAggregate } from "./aggregators/telemetry";

export interface SimPromotePort {
  promote(input: SimPromoteInput): Promise<SimPromoteResult>;
}

export interface ModalSuggestionPort {
  emitSuggestionFromModal(
    swarmId: number,
    aggregate: SwarmAggregate,
  ): Promise<number | null>;
}

export interface TelemetrySuggestionPort {
  emitTelemetrySuggestions(aggregate: TelemetryAggregate): Promise<number[]>;
}

export interface SsaSimPromotionDeps {
  promotionService: SimPromotePort;
}

export interface EmitSuggestionDeps {
  promotionService: ModalSuggestionPort;
}

export interface EmitTelemetrySuggestionsDeps {
  promotionService: TelemetrySuggestionPort;
}

export class SsaSimPromotionAdapter implements SimPromotionAdapter {
  constructor(private readonly deps: SsaSimPromotionDeps) {}

  async promote(input: SimPromoteInput): Promise<SimPromoteResult> {
    return this.deps.promotionService.promote(input);
  }
}

export async function emitSuggestionFromModal(
  deps: EmitSuggestionDeps,
  swarmId: number,
  aggregate: SwarmAggregate,
): Promise<number | null> {
  return deps.promotionService.emitSuggestionFromModal(
    swarmId,
    aggregate,
  );
}

export async function emitTelemetrySuggestions(
  deps: EmitTelemetrySuggestionsDeps,
  aggregate: TelemetryAggregate,
): Promise<number[]> {
  return deps.promotionService.emitTelemetrySuggestions(aggregate);
}

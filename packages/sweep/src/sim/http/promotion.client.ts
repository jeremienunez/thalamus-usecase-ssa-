import type { SwarmAggregate } from "../aggregator.service";
import type {
  SimPromotionTelemetryDto,
  TelemetryPromotionAggregateDto,
} from "@interview/shared/dto/sim-promotion.dto";
import { SimHttpClient } from "./client";

export interface SimPromotionHttpClientOpts {
  kernelSecret?: string;
}

export class SimPromotionHttpClient {
  private readonly headers: Record<string, string> | undefined;

  constructor(
    private readonly http: SimHttpClient,
    opts: SimPromotionHttpClientOpts = {},
  ) {
    this.headers = opts.kernelSecret
      ? { "x-sim-kernel-secret": opts.kernelSecret }
      : undefined;
  }

  async emitSuggestionFromModal(input: {
    swarmId: number;
    aggregate: SwarmAggregate;
  }): Promise<void> {
    await this.http.post(
      "/api/sim/promotions/modal",
      {
        swarmId: String(input.swarmId),
        aggregate: input.aggregate,
      },
      { headers: this.headers },
    );
  }

  async emitScalarSuggestions(input: {
    swarmId: number;
    aggregate: TelemetryPromotionAggregateDto;
  }): Promise<void> {
    const body: SimPromotionTelemetryDto = {
      swarmId: String(input.swarmId),
      aggregate: input.aggregate,
    };
    await this.http.post(
      "/api/sim/promotions/scalars",
      body,
      { headers: this.headers },
    );
  }
}

import type { SwarmAggregate } from "../aggregator.service";
import { SimHttpClient } from "./client";

export interface SimPromotionHttpClientOpts {
  kernelSecret?: string;
}

export interface TelemetryPromotionScalarStats {
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

export interface TelemetryPromotionAggregate {
  swarmId: number;
  satelliteId: number;
  totalFish: number;
  succeededFish: number;
  failedFish: number;
  quorumMet: boolean;
  scalars: Record<string, TelemetryPromotionScalarStats | undefined>;
  simConfidence: number;
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
    aggregate: TelemetryPromotionAggregate;
  }): Promise<void> {
    await this.http.post(
      "/api/sim/promotions/scalars",
      {
        swarmId: String(input.swarmId),
        aggregate: input.aggregate,
      },
      { headers: this.headers },
    );
  }
}

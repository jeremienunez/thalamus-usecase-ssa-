import type { SwarmAggregate } from "../aggregator.service";
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
    aggregate: Record<string, unknown>;
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

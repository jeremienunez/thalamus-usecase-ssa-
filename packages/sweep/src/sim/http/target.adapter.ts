import type { SimScenarioContextProvider } from "../ports/scenario-context.port";
import type { SimTargetsDto } from "@interview/shared/dto/sim-target.dto";
import { SimHttpClient } from "./client";

export class SimScenarioContextHttpAdapter implements SimScenarioContextProvider {
  constructor(private readonly http: SimHttpClient) {}

  async loadContext(args: {
    simRunId: number;
    seedHints: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null> {
    void args.seedHints;
    const dto = await this.http.get<SimTargetsDto>(
      `/api/sim/runs/${args.simRunId}/targets`,
    );
    return dto.scenarioContext as unknown as Record<string, unknown> | null;
  }
}

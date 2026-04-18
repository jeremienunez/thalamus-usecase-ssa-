import type { SimScenarioContextProvider } from "../ports/scenario-context.port";
import { SimHttpClient } from "./client";

interface ScenarioContextDto {
  scenarioContext: Record<string, unknown> | null;
}

export class SimScenarioContextHttpAdapter implements SimScenarioContextProvider {
  constructor(private readonly http: SimHttpClient) {}

  async loadContext(args: {
    simRunId: number;
    seedHints: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null> {
    void args.seedHints;
    const dto = await this.http.get<ScenarioContextDto>(
      `/api/sim/runs/${args.simRunId}/targets`,
    );
    return dto.scenarioContext;
  }
}

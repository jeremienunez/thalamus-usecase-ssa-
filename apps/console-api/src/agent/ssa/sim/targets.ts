/**
 * SsaTurnTargetProvider — SSA adapter over console-api's SimTargetService.
 *
 * The SSA pack should not own SQL. Route/service-owned target composition
 * lives in `src/services/sim-target.service.ts`; this adapter only bridges
 * that service into the kernel port expected by `@interview/sweep`.
 */

import type { SimScenarioContextProvider } from "@interview/sweep";
import type { SimTargetService } from "../../../services/sim-target.service";

export interface SsaTurnTargetDeps {
  targetService: Pick<SimTargetService, "loadTargets">;
}

export class SsaTurnTargetProvider implements SimScenarioContextProvider {
  constructor(private readonly deps: SsaTurnTargetDeps) {}

  async loadContext(args: {
    simRunId: number;
    seedHints: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null> {
    const bag = await this.deps.targetService.loadTargets(BigInt(args.simRunId));
    return {
      telemetryTarget: bag.telemetryTarget,
      pcEstimatorTarget: bag.pcEstimatorTarget,
    };
  }
}

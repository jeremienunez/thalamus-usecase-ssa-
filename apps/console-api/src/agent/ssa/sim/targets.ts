/**
 * SsaTurnTargetProvider — fuses the two SSA target loaders into a single port.
 *
 * TODO(Plan 2 · B.2): move bodies of
 *   packages/sweep/src/sim/load-telemetry-target.ts + load-pc-target.ts into
 *   this file. Consume console-api's SatelliteRepository for satellite/bus
 *   lookups — do NOT duplicate the satellite SQL (Plan 1 already owns it).
 *
 * The returned bag is merged into AgentContext.domain by the kernel; the
 * pack's SimPromptComposer reads the relevant sections.
 */

import type { SimTurnTargetProvider } from "@interview/sweep";

export interface SsaTurnTargetDeps {
  // TODO(B.2): satelliteRepo: SatelliteRepository;
  // TODO(B.2): busDatasheetLoader: { lookupBusPrior(name): ... };
  _placeholder?: never;
}

export class SsaTurnTargetProvider implements SimTurnTargetProvider {
  constructor(private readonly _deps: SsaTurnTargetDeps = {}) {}

  async loadTargets(_args: {
    simRunId: number;
    seedHints: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    // TODO(B.2): implement — dispatch on seedHints.kind
    //   "uc_telemetry_inference" → telemetryTarget bag
    //   "uc_pc_estimator"        → pcEstimatorTarget bag
    //   otherwise                → {} (UC1 / UC3 operator behaviour)
    throw new Error("SsaTurnTargetProvider.loadTargets: TODO Plan 2 · B.2");
  }
}

/**
 * Sweep / sim-side registrar for the generic runtime-config registry.
 *
 * Called at console-api boot to declare sweep- and sim-owned config
 * domains. Each new domain = (1) extend RuntimeConfigDomain in shared,
 * (2) add a registerDomain call here. No console-api edit.
 *
 * `sim.*` domains live here because the sim kernel ships inside the
 * sweep package (packages/sweep/src/sim/*).
 */

import {
  type RuntimeConfigRegistrar,
  DEFAULT_NANO_SWEEP_CONFIG,
  DEFAULT_SIM_SWARM_CONFIG,
  DEFAULT_SIM_FISH_CONFIG,
  DEFAULT_SIM_EMBEDDING_CONFIG,
  MODEL_PRESETS,
  REASONING_EFFORT_CHOICES,
} from "@interview/shared/config";

export function registerSweepConfigDomains(
  r: RuntimeConfigRegistrar,
): void {
  r.registerDomain("sweep.nanoSweep", {
    defaults: DEFAULT_NANO_SWEEP_CONFIG,
    schema: {
      batchSize: "number",
      nullScanMaxIdsPerSuggestion: "number",
    },
  });

  r.registerDomain("sim.swarm", {
    defaults: DEFAULT_SIM_SWARM_CONFIG,
    schema: {
      defaultFishConcurrency: "number",
      defaultQuorumPct: "number",
    },
  });

  r.registerDomain("sim.fish", {
    defaults: DEFAULT_SIM_FISH_CONFIG,
    schema: {
      model: { kind: "string", choices: MODEL_PRESETS.map((p) => p.value) },
      reasoningEffort: { kind: "string", choices: REASONING_EFFORT_CHOICES },
      maxOutputTokens: "number",
      temperature: "number",
      thinking: "boolean",
    },
  });

  r.registerDomain("sim.embedding", {
    defaults: DEFAULT_SIM_EMBEDDING_CONFIG,
    schema: {
      embedConcurrency: "number",
    },
  });
}

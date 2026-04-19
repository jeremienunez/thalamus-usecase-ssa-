/**
 * Thalamus-side registrar for the generic runtime-config registry.
 *
 * Called at console-api boot to declare all thalamus-owned config
 * domains (defaults + schema). The console-api RuntimeConfigService
 * holds no hardcoded schema table — each package ships its own.
 *
 * Adding a new thalamus domain = (1) extend `RuntimeConfigDomain` union
 * in `@interview/shared/config`, (2) add a registerDomain call here.
 * No console-api edit.
 */

import {
  type RuntimeConfigRegistrar,
  DEFAULT_NANO_CONFIG,
  DEFAULT_NANO_SWARM_CONFIG,
  DEFAULT_THALAMUS_PLANNER_CONFIG,
  DEFAULT_THALAMUS_CORTEX_CONFIG,
  DEFAULT_THALAMUS_REFLEXION_CONFIG,
  MODEL_PRESETS,
  PROVIDER_CHOICES,
  REASONING_EFFORT_CHOICES,
  REASONING_FORMAT_CHOICES,
  VERBOSITY_CHOICES,
} from "@interview/shared/config";

export function registerThalamusConfigDomains(
  r: RuntimeConfigRegistrar,
): void {
  r.registerDomain("thalamus.nano", {
    defaults: DEFAULT_NANO_CONFIG,
    schema: {
      model: {
        kind: "string",
        choices: MODEL_PRESETS.map((p) => p.value),
      },
      callTimeoutMs: "number",
    },
  });

  r.registerDomain("thalamus.nanoSwarm", {
    defaults: DEFAULT_NANO_SWARM_CONFIG,
    schema: {
      waveSize: "number",
      waveDelayMs: "number",
      maxMicroQueries: "number",
    },
  });

  r.registerDomain("thalamus.planner", {
    defaults: DEFAULT_THALAMUS_PLANNER_CONFIG,
    schema: {
      maxCortices: "number",
      mandatoryStrategist: "boolean",
      provider: { kind: "string", choices: PROVIDER_CHOICES },
      model: {
        kind: "string",
        choices: MODEL_PRESETS.map((p) => p.value),
      },
      callTimeoutMs: "number",
      maxCostUsd: "number",
      reasoningEffort: { kind: "string", choices: REASONING_EFFORT_CHOICES },
      maxOutputTokens: "number",
      temperature: "number",
      verbosity: { kind: "string", choices: VERBOSITY_CHOICES },
      thinking: "boolean",
      reasoningFormat: { kind: "string", choices: REASONING_FORMAT_CHOICES },
      reasoningSplit: "boolean",
      forcedCortices: "string[]",
      disabledCortices: "string[]",
    },
  });

  r.registerDomain("thalamus.cortex", {
    defaults: DEFAULT_THALAMUS_CORTEX_CONFIG,
    schema: {
      overrides: "json",
    },
  });

  r.registerDomain("thalamus.reflexion", {
    defaults: DEFAULT_THALAMUS_REFLEXION_CONFIG,
    schema: {
      maxIterations: "number",
      minConfidenceToStop: "number",
      stopOnNoNewFindings: "boolean",
    },
  });
}

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

import { z } from "zod";
import {
  type RuntimeConfigRegistrar,
  DEFAULT_NANO_CONFIG,
  DEFAULT_NANO_SWARM_CONFIG,
  DEFAULT_THALAMUS_PLANNER_CONFIG,
  DEFAULT_THALAMUS_CORTEX_CONFIG,
  DEFAULT_THALAMUS_REFLEXION_CONFIG,
  DEFAULT_THALAMUS_BUDGETS_CONFIG,
  MODEL_PRESETS,
  PROVIDER_CHOICES,
  REASONING_EFFORT_CHOICES,
  REASONING_FORMAT_CHOICES,
  VERBOSITY_CHOICES,
} from "@interview/shared/config";

const budgetRowSchema = z.object({
  maxIterations: z.number().int().min(1).max(20),
  maxCost: z.number().min(0).max(10),
  confidenceTarget: z.number().min(0).max(1),
  coverageTarget: z.number().min(0).max(1),
  minFindingsToStop: z.number().int().min(0).max(50),
});

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
      cortexTimeoutMs: "number",
      maxFindingsPerCortex: "number",
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

  r.registerDomain("thalamus.budgets", {
    defaults: DEFAULT_THALAMUS_BUDGETS_CONFIG,
    schema: {
      simple: "json",
      moderate: "json",
      deep: "json",
    },
    validate: (merged) => {
      for (const key of ["simple", "moderate", "deep"] as const) {
        const row = merged[key];
        if (row !== undefined) budgetRowSchema.parse(row);
      }
    },
  });
}

import { describe, expect, it } from "vitest";
import {
  CreateRunBodySchema,
  StartTelemetryBodySchema,
  SwarmConfigSchema,
  SimConfigSchema,
} from "../../../src/schemas/sim.schema";

const FORBIDDEN_LLM_KEYS = [
  "provider",
  "model",
  "reasoningEffort",
  "verbosity",
  "thinking",
  "reasoningFormat",
  "reasoningSplit",
  "maxOutputTokens",
  "temperature",
  "topP",
] as const;

const SWARM_CONFIG = {
  llmMode: "fixtures",
  quorumPct: 0.8,
  perFishTimeoutMs: 60_000,
  fishConcurrency: 4,
  nanoModel: "stub",
  seed: 42,
} as const;

const SIM_CONFIG = {
  turnsPerDay: 1,
  maxTurns: 3,
  llmMode: "fixtures",
  seed: 42,
  nanoModel: "stub",
  perFishTimeoutMs: 60_000,
} as const;

function forbiddenValue(key: string): unknown {
  if (key === "temperature") return 0.2;
  if (key === "maxOutputTokens") return 1024;
  if (key === "thinking" || key === "reasoningSplit") return true;
  return "central-config-only";
}

describe("sim config LLM boundary", () => {
  it.each(FORBIDDEN_LLM_KEYS)("rejects %s on swarm config", (key) => {
    const parsed = SwarmConfigSchema.safeParse({
      ...SWARM_CONFIG,
      [key]: forbiddenValue(key),
    });

    expect(parsed.success).toBe(false);
  });

  it.each(FORBIDDEN_LLM_KEYS)("rejects %s on run config", (key) => {
    const parsed = SimConfigSchema.safeParse({
      ...SIM_CONFIG,
      [key]: forbiddenValue(key),
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects LLM knobs in launcher partial config", () => {
    const parsed = StartTelemetryBodySchema.safeParse({
      satelliteId: "1",
      config: {
        perFishTimeoutMs: 60_000,
        temperature: 0.2,
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects LLM knobs on the create-run API boundary", () => {
    const parsed = CreateRunBodySchema.safeParse({
      swarmId: "1",
      fishIndex: 0,
      kind: "uc_telemetry_inference",
      seedApplied: {},
      perturbation: { kind: "noop" },
      config: {
        ...SIM_CONFIG,
        reasoningEffort: "high",
      },
    });

    expect(parsed.success).toBe(false);
  });
});

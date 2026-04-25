import { describe, expect, it } from "vitest";
import type { SimConfig, SwarmConfig } from "@interview/db-schema";
import type { SimConfigDto, SwarmConfigDto } from "@interview/shared/dto";
import { swarmConfigSchema } from "../../src/sim/schema";

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

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Assert<T extends true> = T;

type AllowedSwarmConfigKeys =
  | "llmMode"
  | "quorumPct"
  | "perFishTimeoutMs"
  | "fishConcurrency"
  | "nanoModel"
  | "seed";
type AllowedSimConfigKeys =
  | "turnsPerDay"
  | "maxTurns"
  | "llmMode"
  | "seed"
  | "nanoModel"
  | "perFishTimeoutMs";

type _DbSwarmConfigIsExact = Assert<
  Equal<keyof SwarmConfig, AllowedSwarmConfigKeys>
>;
type _DtoSwarmConfigIsExact = Assert<
  Equal<keyof SwarmConfigDto, AllowedSwarmConfigKeys>
>;
type _DbSimConfigIsExact = Assert<Equal<keyof SimConfig, AllowedSimConfigKeys>>;
type _DtoSimConfigIsExact = Assert<
  Equal<keyof SimConfigDto, AllowedSimConfigKeys>
>;

function forbiddenValue(key: string): unknown {
  if (key === "temperature") return 0.2;
  if (key === "maxOutputTokens") return 1024;
  if (key === "thinking" || key === "reasoningSplit") return true;
  return "central-config-only";
}

describe("sweep sim config LLM boundary", () => {
  it.each(FORBIDDEN_LLM_KEYS)(
    "keeps %s out of the launch config schema",
    (key) => {
      const parsed = swarmConfigSchema.safeParse({
        llmMode: "fixtures",
        [key]: forbiddenValue(key),
      });

      expect(parsed.success).toBe(false);
    },
  );

  it("keeps the executable LLM tuning source in sim.fish, not sim launch config", () => {
    expect(Object.keys(swarmConfigSchema.shape).sort()).toEqual([
      "fishConcurrency",
      "llmMode",
      "nanoModel",
      "perFishTimeoutMs",
      "quorumPct",
      "seed",
    ]);
  });
});

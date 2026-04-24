import { describe, expect, it } from "vitest";
import type { CortexOutput } from "../../src/cortices/types";
import { estimateCortexOutputCostUsd } from "../../src/services/cost-estimator";

function output(metadata: CortexOutput["metadata"]): CortexOutput {
  return {
    findings: [],
    metadata,
  };
}

describe("estimateCortexOutputCostUsd", () => {
  it("uses provider-specific prompt and completion prices when token split is available", () => {
    expect(
      estimateCortexOutputCostUsd(
        output({
          tokensUsed: 1_000,
          promptTokens: 800,
          completionTokens: 200,
          duration: 1,
          model: "kimi",
        }),
      ),
    ).toBeCloseTo(0.00098, 10);
  });

  it("keeps local and failed outputs free for budget accounting", () => {
    expect(
      estimateCortexOutputCostUsd(
        output({ tokensUsed: 10_000, duration: 1, model: "local/gemma" }),
      ),
    ).toBe(0);
    expect(
      estimateCortexOutputCostUsd(
        output({ tokensUsed: 10_000, duration: 1, model: "minimax:invalid" }),
      ),
    ).toBe(0);
  });

  it("falls back to the legacy flat estimate for unknown test models", () => {
    expect(
      estimateCortexOutputCostUsd(
        output({ tokensUsed: 500, duration: 1, model: "test-model" }),
      ),
    ).toBe(0.001);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THALAMUS_BUDGETS_CONFIG,
  StaticConfigProvider,
  type ThalamusBudgetsConfig,
} from "@interview/shared/config";
import {
  getBudgetsConfig,
  setBudgetsConfigProvider,
} from "@interview/thalamus";

describe("thalamus.budgets provider", () => {
  afterEach(() => {
    setBudgetsConfigProvider(
      new StaticConfigProvider(DEFAULT_THALAMUS_BUDGETS_CONFIG),
    );
  });

  it("returns defaults when no provider has been injected", async () => {
    const cfg = await getBudgetsConfig();
    expect(cfg.deep.maxCost).toBe(0.1);
  });

  it("honours an injected override", async () => {
    const override: ThalamusBudgetsConfig = {
      ...DEFAULT_THALAMUS_BUDGETS_CONFIG,
      deep: { ...DEFAULT_THALAMUS_BUDGETS_CONFIG.deep, maxCost: 0.25 },
    };

    setBudgetsConfigProvider(new StaticConfigProvider(override));

    const cfg = await getBudgetsConfig();
    expect(cfg.deep.maxCost).toBe(0.25);
  });
});

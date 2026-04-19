import { describe, it, expect } from "vitest";
import { noopDomainConfig, type DomainConfig } from "../src/cortices/types";
import { buildGenericPlannerSystemPrompt } from "../src/prompts/planner-generic.prompt";

describe("DomainConfig — new optional seams", () => {
  it("noopDomainConfig leaves the new seams undefined", () => {
    expect(noopDomainConfig.plannerPrompt).toBeUndefined();
    expect(noopDomainConfig.fallbackPlan).toBeUndefined();
    expect(noopDomainConfig.synthesisCortexName).toBeUndefined();
    expect(noopDomainConfig.extractEntities).toBeUndefined();
    expect(noopDomainConfig.isVerificationRelevantEntityType).toBeUndefined();
  });

  it("accepts a DomainConfig with all new seams populated", () => {
    const cfg: DomainConfig = {
      ...noopDomainConfig,
      plannerPrompt: ({ headers, cortexNames }) =>
        `Plan across ${cortexNames.length} cortices:\n${headers}`,
      fallbackPlan: (query) => ({
        intent: query,
        complexity: "moderate",
        nodes: [],
      }),
      synthesisCortexName: "synth",
      extractEntities: (text) => ({
        primary: [text],
        hasContent: text.length > 0,
      }),
      isVerificationRelevantEntityType: (t) => t === "relevant_entity",
    };
    expect(cfg.plannerPrompt?.({ headers: "h", cortexNames: [] })).toContain(
      "0 cortices",
    );
    expect(cfg.fallbackPlan?.("q")?.intent).toBe("q");
    expect(cfg.synthesisCortexName).toBe("synth");
    expect(cfg.extractEntities?.("x").hasContent).toBe(true);
    expect(cfg.isVerificationRelevantEntityType?.("relevant_entity")).toBe(
      true,
    );
    expect(cfg.isVerificationRelevantEntityType?.("other")).toBe(false);
  });
});

describe("buildGenericPlannerSystemPrompt", () => {
  it("emits a prompt without SSA vocabulary", () => {
    const prompt = buildGenericPlannerSystemPrompt({
      headers: "some_cortex(): do a thing",
      cortexNames: ["some_cortex"],
    });
    expect(prompt).not.toMatch(
      /SSA|Space Situational Awareness|satellite|NORAD|conjunction|fleet/i,
    );
    expect(prompt).toContain("some_cortex");
    expect(prompt).toContain("DAG");
    expect(prompt).toContain("JSON");
  });

  it("lists every cortex name in the whitelist", () => {
    const prompt = buildGenericPlannerSystemPrompt({
      headers: "a(): …\nb(): …",
      cortexNames: ["alpha_cortex", "beta_cortex"],
    });
    expect(prompt).toContain("alpha_cortex");
    expect(prompt).toContain("beta_cortex");
  });
});

/**
 * ThalamusPlanner — DomainConfig seam consumption (Phase 1 / Task 1.2).
 *
 * Covers the two injection points added in Task 1.1:
 *   - plannerPrompt:  custom system prompt builder wins over the default
 *   - fallbackPlan:   custom fallback wins over fallbackCortices-flat which
 *                     wins over the legacy hardcoded SSA pipeline
 *
 * The LLM path is intentionally NOT exercised here — `plan()` integration
 * is covered by e2e cycle tests. These unit tests prove the seams are
 * consumed, not the full DAG-generation pipeline.
 */

import { describe, it, expect } from "vitest";
import { ThalamusPlanner } from "../src/services/thalamus-planner.service";
import type { CortexRegistry } from "../src/cortices/registry";
import type { DAGPlan } from "../src/cortices/types";

function mkRegistry(): CortexRegistry {
  // resolveFallbackPlan + buildSystemPrompt don't touch the registry; a
  // stub that satisfies the type is enough.
  return {} as unknown as CortexRegistry;
}

describe("ThalamusPlanner.resolveFallbackPlan — selection order", () => {
  it("uses config.fallbackPlan when provided", () => {
    const customPlan: DAGPlan = {
      intent: "injected",
      complexity: "simple",
      nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
    };
    const planner = new ThalamusPlanner(mkRegistry(), {
      fallbackPlan: () => customPlan,
    });
    const out = planner.resolveFallbackPlan("any query");
    expect(out).toBe(customPlan);
  });

  it("flattens config.fallbackCortices to parallel nodes when fallbackPlan absent", () => {
    const planner = new ThalamusPlanner(mkRegistry(), {
      fallbackCortices: ["alpha", "beta"],
    });
    const plan = planner.resolveFallbackPlan("q");
    expect(plan.intent).toBe("q");
    expect(plan.nodes.map((n) => n.cortex).sort()).toEqual(["alpha", "beta"]);
    expect(plan.nodes.every((n) => n.dependsOn.length === 0)).toBe(true);
  });

  it("returns an empty DAG when neither fallbackPlan nor fallbackCortices provided", () => {
    // Kernel default is empty — domains must inject their own fallback.
    const planner = new ThalamusPlanner(mkRegistry());
    const plan = planner.resolveFallbackPlan("q");
    expect(plan.intent).toBe("q");
    expect(plan.nodes).toEqual([]);
  });
});

describe("ThalamusPlanner.buildSystemPrompt — selection order", () => {
  it("uses config.plannerPrompt when provided", () => {
    const planner = new ThalamusPlanner(mkRegistry(), {
      plannerPrompt: ({ headers, cortexNames }) =>
        `CUSTOM:${cortexNames.length}:${headers}`,
    });
    const out = planner.buildSystemPrompt({ headers: "H", cortexNames: ["x"] });
    expect(out).toBe("CUSTOM:1:H");
  });

  it("falls back to the generic prompt (no SSA vocabulary) when config.plannerPrompt absent", () => {
    const planner = new ThalamusPlanner(mkRegistry());
    const out = planner.buildSystemPrompt({
      headers: "some_cortex(): …",
      cortexNames: ["some_cortex"],
    });
    expect(out).not.toMatch(/SSA|Space Situational Awareness|NORAD|fleet/i);
    expect(out).toContain("some_cortex");
    expect(out).toContain("DAG");
  });
});

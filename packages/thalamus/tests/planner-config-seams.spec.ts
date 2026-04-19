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

  it("falls back to the legacy SSA pipeline when neither fallbackPlan nor fallbackCortices provided", () => {
    // This is the compatibility floor. Task 5 removes the legacy SSA defaults
    // once SSA domain-config injects fallbackPlan.
    const planner = new ThalamusPlanner(mkRegistry());
    const plan = planner.resolveFallbackPlan("q");
    expect(plan.nodes.map((n) => n.cortex)).toEqual([
      "fleet_analyst",
      "conjunction_analysis",
      "regime_profiler",
      "strategist",
    ]);
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

  it("falls back to the legacy SSA prompt when config.plannerPrompt absent", () => {
    // Compatibility floor. Task 5 replaces this default with the generic
    // prompt once SSA injects its own via domain-config.
    const planner = new ThalamusPlanner(mkRegistry());
    const out = planner.buildSystemPrompt({
      headers: "fleet_analyst(): …",
      cortexNames: ["fleet_analyst"],
    });
    expect(out).toMatch(/SSA|Space Situational Awareness/);
    expect(out).toContain("fleet_analyst");
  });
});

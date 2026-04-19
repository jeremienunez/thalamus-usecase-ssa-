/**
 * SSA DomainConfig — Phase 1 · Task 1.3 of thalamus agnosticity cleanup.
 *
 * Proves the SSA domain ships:
 *   - plannerPrompt with SSA vocabulary (NORAD, fleet, SSA framing)
 *   - fallbackPlan with the 4-cortex SSA pipeline
 *   - synthesisCortexName = "strategist"
 *
 * The kernel (packages/thalamus) falls back to generic defaults when these
 * seams are absent; this test is the contract that SSA provides non-default
 * values.
 */

import { describe, it, expect } from "vitest";
import { buildSsaDomainConfig } from "../../../../src/agent/ssa/domain-config";

describe("buildSsaDomainConfig — Phase 1 seams", () => {
  it("ships a planner prompt that uses SSA vocabulary", () => {
    const cfg = buildSsaDomainConfig();
    expect(cfg.plannerPrompt).toBeDefined();
    const prompt = cfg.plannerPrompt!({
      headers: "fleet_analyst(): fleet analysis cortex",
      cortexNames: ["fleet_analyst", "strategist"],
    });
    expect(prompt).toMatch(/SSA|Space Situational Awareness/);
    expect(prompt).toContain("fleet_analyst");
    expect(prompt).toContain("strategist");
  });

  it("ships a fallback plan with the 4-cortex SSA pipeline ending on strategist", () => {
    const cfg = buildSsaDomainConfig();
    expect(cfg.fallbackPlan).toBeDefined();
    const plan = cfg.fallbackPlan!("any query");
    const cortexNames = plan.nodes.map((n) => n.cortex);
    expect(cortexNames).toEqual(
      expect.arrayContaining([
        "fleet_analyst",
        "conjunction_analysis",
        "regime_profiler",
        "strategist",
      ]),
    );
    const strategist = plan.nodes.find((n) => n.cortex === "strategist");
    expect(strategist?.dependsOn.sort()).toEqual([
      "conjunction_analysis",
      "fleet_analyst",
      "regime_profiler",
    ]);
    expect(plan.intent).toBe("any query");
  });

  it("names strategist as the synthesis cortex", () => {
    expect(buildSsaDomainConfig().synthesisCortexName).toBe("strategist");
  });
});

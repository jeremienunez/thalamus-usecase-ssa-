import { describe, it, expect } from "vitest";
import { SsaFindingRoutingPolicy } from "../../../../../src/agent/ssa/sweep/finding-routing.ssa";

describe("SsaFindingRoutingPolicy", () => {
  const policy = new SsaFindingRoutingPolicy();

  it("maps investment-tier cortices to ['investment']", () => {
    expect(policy.tiersForSource({ kind: "cortex", name: "strategist" })).toEqual([
      "investment",
    ]);
    expect(policy.tiersForSource({ kind: "cortex", name: "fleet_analyst" })).toEqual([
      "investment",
    ]);
    expect(policy.tiersForSource({ kind: "cortex", name: "debris_forecaster" })).toEqual([
      "investment",
    ]);
  });

  it("maps apogee_tracker to all paid tiers", () => {
    expect(
      policy.tiersForSource({ kind: "cortex", name: "apogee_tracker" }),
    ).toEqual(["investment", "enthusiast", "franchise"]);
  });

  it("maps franchise-specific cortices", () => {
    expect(
      policy.tiersForSource({ kind: "cortex", name: "payload_profiler" }),
    ).toEqual(["franchise"]);
    expect(
      policy.tiersForSource({ kind: "cortex", name: "regime_profiler" }),
    ).toEqual(["franchise"]);
  });

  it("returns [] for admin-only cortices (briefing_producer, data_auditor, classification_auditor)", () => {
    expect(
      policy.tiersForSource({ kind: "cortex", name: "briefing_producer" }),
    ).toEqual([]);
    expect(
      policy.tiersForSource({ kind: "cortex", name: "data_auditor" }),
    ).toEqual([]);
    expect(
      policy.tiersForSource({ kind: "cortex", name: "classification_auditor" }),
    ).toEqual([]);
  });

  it("returns [] for unknown cortex (admin fallback)", () => {
    expect(
      policy.tiersForSource({ kind: "cortex", name: "made_up_cortex" }),
    ).toEqual([]);
  });

  it("returns [] for sweep and research-cycle sources (admin-only paths)", () => {
    expect(policy.tiersForSource({ kind: "sweep", name: "any" })).toEqual([]);
    expect(
      policy.tiersForSource({ kind: "research-cycle", name: "any" }),
    ).toEqual([]);
  });

  it("maps consumption source to all paid tiers", () => {
    expect(
      policy.tiersForSource({ kind: "consumption", name: "any" }),
    ).toEqual(["investment", "enthusiast", "franchise"]);
  });

  it("returns [] for unknown source kinds", () => {
    expect(policy.tiersForSource({ kind: "unknown", name: "any" })).toEqual(
      [],
    );
  });
});

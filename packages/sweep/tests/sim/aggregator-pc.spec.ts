import { describe, it, expect } from "vitest";
import {
  computePcAggregate,
  aggregateToSuggestion,
  severityFromMedian,
} from "../../src/sim/aggregator-pc";
import type { TurnAction } from "@interview/db-schema";

// The aggregator treats `dominantMode` and `flags` as opaque strings for
// clustering; the test uses synthetic values ("nominal", "tight", "loose",
// "cov-clamped") that don't match the strict TurnAction union. We cast via
// `unknown` to keep the spec readable without weakening the prod type.
function est(
  pc: number,
  mode: string = "nominal",
  flags: string[] = [],
): TurnAction {
  return {
    kind: "estimate_pc",
    conjunctionId: 42,
    pcEstimate: pc,
    pcBand: { p5: pc / 2, p50: pc, p95: pc * 2 },
    dominantMode: mode,
    rationale: "test",
    assumptions: {
      hardBodyRadiusMeters: 10,
      covarianceScale: "nominal",
      conjunctionGeometry: "test",
    },
    flags,
  } as unknown as TurnAction;
}

describe("computePcAggregate", () => {
  it("returns null on empty input", () => {
    expect(computePcAggregate([])).toBeNull();
  });

  it("computes median / p5 / p95 / sigma across samples", () => {
    const agg = computePcAggregate(
      [est(1e-5), est(1e-4), est(1e-3), est(1e-4), est(1e-4)],
      42,
    )!;
    expect(agg.fishCount).toBe(5);
    expect(agg.medianPc).toBeCloseTo(1e-4, 10);
    expect(agg.p5Pc).toBeLessThanOrEqual(agg.medianPc);
    expect(agg.p95Pc).toBeGreaterThanOrEqual(agg.medianPc);
    expect(agg.sigmaPc).toBeGreaterThan(0);
  });

  it("surfaces clusters with >= 2 fish, sorted by fishCount desc", () => {
    const agg = computePcAggregate([
      est(1e-4, "nominal", []),
      est(2e-4, "nominal", []),
      est(5e-3, "tight", ["cov-clamped"]),
      est(6e-3, "tight", ["cov-clamped"]),
      est(7e-3, "tight", ["cov-clamped"]),
      est(3e-6, "loose"),
    ])!;
    expect(agg.clusters.length).toBe(2);
    expect(agg.clusters[0]!.fishCount).toBe(3);
    expect(agg.clusters[0]!.mode).toBe("tight");
    expect(agg.clusters[0]!.flags).toEqual(["cov-clamped"]);
  });

  it("derives severity from median", () => {
    expect(severityFromMedian(1e-2)).toBe("high");
    expect(severityFromMedian(5e-4)).toBe("medium");
    expect(severityFromMedian(1e-6)).toBe("info");
  });

  it("aggregateToSuggestion preserves payload shape", () => {
    const agg = computePcAggregate([est(1e-4), est(2e-4)], 42)!;
    const s = aggregateToSuggestion(agg);
    expect(s.kind).toBe("pc_estimate");
    expect(s.payload.methodology).toBe("swarm-pc-estimator");
    expect(s.payload.conjunctionId).toBe(42);
  });
});

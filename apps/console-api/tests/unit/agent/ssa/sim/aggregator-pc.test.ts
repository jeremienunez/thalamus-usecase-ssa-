import { describe, it, expect } from "vitest";
import { parseFixture } from "@interview/test-kit";
import {
  computePcAggregate,
  aggregateToSuggestion,
  severityFromMedian,
} from "../../../../../src/agent/ssa/sim/aggregators/pc";
import {
  turnActionSchema,
} from "../../../../../src/agent/ssa/sim/action-schema";

type EstimatePcMode =
  | "elliptical-overlap"
  | "short-encounter"
  | "long-encounter"
  | "unknown";
type EstimatePcFlag =
  | "low-data"
  | "high-uncertainty"
  | "degraded-covariance"
  | "field-required";

function est(
  pc: number,
  mode: EstimatePcMode = "unknown",
  flags: EstimatePcFlag[] = [],
) {
  return parseFixture(turnActionSchema, {
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
  });
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
    const agg = computePcAggregate(
      [
        est(1e-4, "short-encounter", []),
        est(2e-4, "short-encounter", []),
        est(5e-3, "elliptical-overlap", ["degraded-covariance"]),
        est(6e-3, "elliptical-overlap", ["degraded-covariance"]),
        est(7e-3, "elliptical-overlap", ["degraded-covariance"]),
        est(3e-6, "long-encounter"),
      ],
      42,
      [
        { fishIndex: 10, simRunId: 100 },
        { fishIndex: 11, simRunId: 101 },
        { fishIndex: 20, simRunId: 200 },
        { fishIndex: 21, simRunId: 201 },
        { fishIndex: 22, simRunId: 202 },
        { fishIndex: 30, simRunId: 300 },
      ],
    )!;
    expect(agg.clusters.length).toBe(2);
    expect(agg.clusters[0]!.fishCount).toBe(3);
    expect(agg.clusters[0]!.mode).toBe("elliptical-overlap");
    expect(agg.clusters[0]!.flags).toEqual(["degraded-covariance"]);
    expect(agg.clusters[0]!.label).toBe("elliptical-overlap / degraded-covariance");
    expect(agg.clusters[0]!.memberFishIndexes).toEqual([20, 21, 22]);
    expect(agg.clusters[0]!.exemplarFishIndex).toBe(21);
    expect(agg.clusters[0]!.exemplarSimRunId).toBe(201);
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

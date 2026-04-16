import { describe, it, expect } from "vitest";
import { regimeFromMeanMotion, smaFromMeanMotion, classificationTier } from "./satellite-view";

describe("regimeFromMeanMotion", () => {
  it.each([
    [null, "LEO"],
    [15.5, "LEO"],
    [10.9, "HEO"],
    [4.9, "MEO"],
    [1.0, "GEO"],
  ])("mm=%s → %s", (mm, regime) => {
    expect(regimeFromMeanMotion(mm)).toBe(regime);
  });
});

describe("smaFromMeanMotion", () => {
  it("mm=15.5 ≈ 6773 km (ISS-ish)", () => {
    expect(smaFromMeanMotion(15.5)).toBeCloseTo(6773, -2);
  });
  it("mm=1.0027 ≈ 42164 km (GEO)", () => {
    expect(smaFromMeanMotion(1.0027)).toBeCloseTo(42164, -1);
  });
});

describe("classificationTier", () => {
  it.each([
    [null, "unclassified"],
    ["standard", "unclassified"],
    ["restricted access", "restricted"],
    ["sensitive payload", "sensitive"],
  ])("raw=%s → %s", (raw, tier) => {
    expect(classificationTier(raw)).toBe(tier);
  });
});

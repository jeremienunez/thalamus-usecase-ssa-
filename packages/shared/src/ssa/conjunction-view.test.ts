import { describe, it, expect } from "vitest";
import { deriveAction, deriveCovarianceQuality } from "./conjunction-view";

describe("deriveAction", () => {
  it.each([
    [1e-3, "maneuver_candidate"],
    [1e-4, "maneuver_candidate"],
    [9.99e-5, "monitor"],
    [1e-6, "monitor"],
    [9.99e-7, "no_action"],
    [0, "no_action"],
  ])("pc=%s → %s", (pc, action) => {
    expect(deriveAction(pc)).toBe(action);
  });
});

describe("deriveCovarianceQuality", () => {
  it.each([
    [0.05, "HIGH"],
    [0.5, "MED"],
    [5.0, "LOW"],
  ])("sigma=%s → %s", (sigma, quality) => {
    expect(deriveCovarianceQuality(sigma)).toBe(quality);
  });
});

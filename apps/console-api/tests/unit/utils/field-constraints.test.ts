import { describe, it, expect } from "vitest";
import {
  MISSION_WRITABLE_COLUMNS,
  inRange,
  unitMismatch,
} from "../../../src/utils/field-constraints";

describe("MISSION_WRITABLE_COLUMNS", () => {
  it("contains exactly 5 writable fields", () => {
    expect(Object.keys(MISSION_WRITABLE_COLUMNS).sort()).toEqual([
      "launch_year",
      "lifetime",
      "mass_kg",
      "power",
      "variant",
    ]);
  });
});

describe("inRange", () => {
  it("launch_year accepts 1957–2035", () => {
    expect(inRange("launch_year", 1957)).toBe(true);
    expect(inRange("launch_year", 2035)).toBe(true);
    expect(inRange("launch_year", 1850)).toBe(false);
  });
  it("mass_kg rejects negative", () =>
    expect(inRange("mass_kg", -5)).toBe(false));
  it("unknown field passes through", () =>
    expect(inRange("anything", 42)).toBe(true));
});

describe("unitMismatch", () => {
  it("lifetime rejects days/months", () => {
    expect(unitMismatch("lifetime", "months")).toBe(true);
    expect(unitMismatch("lifetime", "years")).toBe(false);
  });
});

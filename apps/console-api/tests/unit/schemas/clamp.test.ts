import { describe, expect, it } from "vitest";
import { clampedInt, clampedNumber } from "../../../src/schemas/clamp";

describe("clampedInt", () => {
  const schema = clampedInt(1, 5, 3);

  it("uses the default when the value is omitted", () => {
    expect(schema.parse(undefined)).toBe(3);
  });

  it("accepts numeric strings and clamps to the configured range", () => {
    expect(schema.parse("0")).toBe(1);
    expect(schema.parse("4")).toBe(4);
    expect(schema.parse(9)).toBe(5);
  });

  it("rejects non-integer, non-finite, and boolean values", () => {
    for (const value of [1.5, NaN, Infinity, -Infinity, true, false, "abc"]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});

describe("clampedNumber", () => {
  const schema = clampedNumber(0.1, 0.9, 0.5);

  it("uses the default when the value is omitted", () => {
    expect(schema.parse(undefined)).toBe(0.5);
  });

  it("accepts numeric strings and clamps to the configured range", () => {
    expect(schema.parse("0.01")).toBe(0.1);
    expect(schema.parse("0.25")).toBe(0.25);
    expect(schema.parse(1.2)).toBe(0.9);
  });

  it("rejects non-finite and boolean values", () => {
    for (const value of [NaN, Infinity, -Infinity, true, false, "abc"]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});

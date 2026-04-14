/**
 * SPEC-SH-003 — CompletenessScorer (adaptive weight normalization)
 * Traceability:
 *   AC-1 full coverage matches weighted sum
 *   AC-2 partial coverage renormalises weights
 *   AC-3 empty coverage returns null score
 *   AC-4 rejects non-finite or negative weights
 *   AC-5 rejects values outside [0,1]
 *   AC-6 deterministic across repeated calls
 *   AC-7 presentKeys and missingKeys partition input
 */
import { describe, it, expect } from "vitest";
import {
  scoreCompleteness,
  type ScorerComponent,
} from "../src/utils/completeness-scorer";

describe("SPEC-SH-003 scoreCompleteness", () => {
  it("AC-1 full coverage matches weighted sum, coverage=1, no missing", () => {
    const components: ScorerComponent[] = [
      { key: "a", weight: 0.5, value: 0.8 },
      { key: "b", weight: 0.3, value: 0.6 },
      { key: "c", weight: 0.2, value: 1.0 },
    ];
    const result = scoreCompleteness(components);
    expect(result.score).toBeCloseTo(0.78, 10);
    expect(result.coverage).toBe(1);
    expect(result.missingKeys).toEqual([]);
    expect([...result.presentKeys].sort()).toEqual(["a", "b", "c"]);
  });

  it("AC-2 partial coverage renormalises weights across present only", () => {
    const components: ScorerComponent[] = [
      { key: "a", weight: 0.5, value: 0.8 },
      { key: "b", weight: 0.3, value: null },
      { key: "c", weight: 0.2, value: 1.0 },
    ];
    const result = scoreCompleteness(components);
    // (0.5*0.8 + 0.2*1.0) / (0.5 + 0.2) = 0.6 / 0.7
    expect(result.score).toBeCloseTo(0.6 / 0.7, 10);
    expect(result.coverage).toBeCloseTo(0.7, 10);
    expect(result.missingKeys).toEqual(["b"]);
    expect([...result.presentKeys].sort()).toEqual(["a", "c"]);
  });

  it("AC-2 treats undefined value as missing", () => {
    const components: ScorerComponent[] = [
      { key: "a", weight: 1, value: 0.5 },
      { key: "b", weight: 1, value: undefined },
    ];
    const result = scoreCompleteness(components);
    expect(result.score).toBe(0.5);
    expect(result.coverage).toBe(0.5);
    expect(result.missingKeys).toEqual(["b"]);
  });

  it("AC-3 empty coverage yields score=null, coverage=0, no throw", () => {
    const components: ScorerComponent[] = [
      { key: "a", weight: 0.5, value: null },
      { key: "b", weight: 0.3, value: undefined },
      { key: "c", weight: 0.2, value: null },
    ];
    let result!: ReturnType<typeof scoreCompleteness>;
    expect(() => {
      result = scoreCompleteness(components);
    }).not.toThrow();
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
    expect([...result.missingKeys].sort()).toEqual(["a", "b", "c"]);
    expect(result.presentKeys).toEqual([]);
  });

  it("AC-3 empty input array yields score=null, coverage=0", () => {
    const result = scoreCompleteness([]);
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.presentKeys).toEqual([]);
    expect(result.missingKeys).toEqual([]);
  });

  it("AC-4 rejects negative weight and names offending key", () => {
    const bad: ScorerComponent[] = [
      { key: "a", weight: 1, value: 0.5 },
      { key: "bad_key", weight: -0.1, value: 0.5 },
    ];
    expect(() => scoreCompleteness(bad)).toThrow(RangeError);
    expect(() => scoreCompleteness(bad)).toThrow(/bad_key/);
  });

  it("AC-4 rejects NaN weight and names offending key", () => {
    const bad: ScorerComponent[] = [
      { key: "nan_weight", weight: Number.NaN, value: 0.5 },
    ];
    expect(() => scoreCompleteness(bad)).toThrow(RangeError);
    expect(() => scoreCompleteness(bad)).toThrow(/nan_weight/);
  });

  it("AC-4 rejects Infinity weight and names offending key", () => {
    const bad: ScorerComponent[] = [
      { key: "inf_weight", weight: Number.POSITIVE_INFINITY, value: 0.5 },
    ];
    expect(() => scoreCompleteness(bad)).toThrow(RangeError);
    expect(() => scoreCompleteness(bad)).toThrow(/inf_weight/);
  });

  it("AC-5 rejects value > 1 and names offending key", () => {
    const bad: ScorerComponent[] = [
      { key: "out_high", weight: 1, value: 1.4 },
    ];
    expect(() => scoreCompleteness(bad)).toThrow(RangeError);
    expect(() => scoreCompleteness(bad)).toThrow(/out_high/);
  });

  it("AC-5 rejects value < 0 and names offending key", () => {
    const bad: ScorerComponent[] = [
      { key: "out_low", weight: 1, value: -0.1 },
    ];
    expect(() => scoreCompleteness(bad)).toThrow(RangeError);
    expect(() => scoreCompleteness(bad)).toThrow(/out_low/);
  });

  it("AC-5 rejects non-finite value (NaN) and names offending key", () => {
    const bad: ScorerComponent[] = [
      { key: "nan_value", weight: 1, value: Number.NaN },
    ];
    expect(() => scoreCompleteness(bad)).toThrow(RangeError);
    expect(() => scoreCompleteness(bad)).toThrow(/nan_value/);
  });

  it("AC-6 deterministic across repeated calls (bitwise-equal results)", () => {
    const components: ScorerComponent[] = [
      { key: "a", weight: 0.37, value: 0.42 },
      { key: "b", weight: 0.21, value: 0.99 },
      { key: "c", weight: 0.42, value: 0.17 },
    ];
    const r1 = scoreCompleteness(components);
    const r2 = scoreCompleteness(components);
    const r3 = scoreCompleteness([...components].reverse());
    expect(r1.score).toBe(r2.score);
    expect(r1.coverage).toBe(r2.coverage);
    // order-independent: same multiset of components → same numeric score
    expect(r3.score).toBe(r1.score);
    expect(r3.coverage).toBe(r1.coverage);
  });

  it("AC-7 presentKeys and missingKeys partition input exactly", () => {
    const components: ScorerComponent[] = [
      { key: "a", weight: 1, value: 0.5 },
      { key: "b", weight: 1, value: null },
      { key: "c", weight: 1, value: 0.9 },
      { key: "d", weight: 1, value: undefined },
    ];
    const result = scoreCompleteness(components);
    const inputKeys = new Set(components.map((c) => c.key));
    const outKeys = new Set([...result.presentKeys, ...result.missingKeys]);
    expect(outKeys).toEqual(inputKeys);
    expect(result.presentKeys.length + result.missingKeys.length).toBe(
      components.length,
    );
    // no duplicates
    expect(new Set(result.presentKeys).size).toBe(result.presentKeys.length);
    expect(new Set(result.missingKeys).size).toBe(result.missingKeys.length);
    // no overlap
    for (const k of result.presentKeys) {
      expect(result.missingKeys).not.toContain(k);
    }
  });

  it("returns score in [0,1] for value=0 corner case", () => {
    const result = scoreCompleteness([
      { key: "a", weight: 1, value: 0 },
      { key: "b", weight: 1, value: 1 },
    ]);
    expect(result.score).toBe(0.5);
  });

  it("returns score=0 when all present values are 0", () => {
    const result = scoreCompleteness([
      { key: "a", weight: 1, value: 0 },
      { key: "b", weight: 1, value: 0 },
    ]);
    expect(result.score).toBe(0);
    expect(result.coverage).toBe(1);
  });
});

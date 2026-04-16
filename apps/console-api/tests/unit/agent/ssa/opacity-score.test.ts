/**
 * OpacityScout — pure scorer tests.
 *
 * Verifies the signal-weight table the skill markdown contracts with.
 * Keep in sync with apps/console-api/src/agent/ssa/skills/opacity-scout.md.
 */

import { describe, it, expect } from "vitest";
import { computeOpacityScore } from "../../../../src/agent/ssa/opacity-score";

const ZERO = {
  payloadUndisclosed: false,
  operatorSensitive: false,
  amateurObservationsCount: 0,
  catalogDropoutCount: 0,
  distinctAmateurSources: 0,
};

describe("OpacityScout — computeOpacityScore", () => {
  it("returns 0 when no signal fires", () => {
    expect(computeOpacityScore(ZERO)).toBe(0);
  });

  it("individual signal weights match the skill contract", () => {
    expect(
      computeOpacityScore({ ...ZERO, payloadUndisclosed: true }),
    ).toBeCloseTo(0.25);
    expect(
      computeOpacityScore({ ...ZERO, operatorSensitive: true }),
    ).toBeCloseTo(0.25);
    expect(
      computeOpacityScore({ ...ZERO, amateurObservationsCount: 3 }),
    ).toBeCloseTo(0.2);
    expect(
      computeOpacityScore({ ...ZERO, catalogDropoutCount: 1 }),
    ).toBeCloseTo(0.2);
  });

  it("applies the corroboration bonus only at ≥ 2 distinct amateur sources", () => {
    expect(
      computeOpacityScore({
        ...ZERO,
        amateurObservationsCount: 5,
        distinctAmateurSources: 1,
      }),
    ).toBeCloseTo(0.2); // obs signal, no bonus
    expect(
      computeOpacityScore({
        ...ZERO,
        amateurObservationsCount: 5,
        distinctAmateurSources: 2,
      }),
    ).toBeCloseTo(0.3); // obs + 0.1 bonus
  });

  it("caps at 1.0 when every signal fires", () => {
    expect(
      computeOpacityScore({
        payloadUndisclosed: true,
        operatorSensitive: true,
        amateurObservationsCount: 10,
        catalogDropoutCount: 5,
        distinctAmateurSources: 4,
      }),
    ).toBeCloseTo(1.0);
  });

  it("a row below the 0.5 emission threshold returns a score < 0.5", () => {
    // Only one hard signal — not enough to emit a finding per the skill rule.
    const score = computeOpacityScore({ ...ZERO, operatorSensitive: true });
    expect(score).toBeLessThan(0.5);
  });

  it("three signals reach the 0.7-band floor", () => {
    const score = computeOpacityScore({
      ...ZERO,
      payloadUndisclosed: true,
      operatorSensitive: true,
      amateurObservationsCount: 2,
    });
    expect(score).toBeCloseTo(0.7);
  });
});

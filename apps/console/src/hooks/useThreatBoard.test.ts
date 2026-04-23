import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThreatBoard } from "./useThreatBoard";
import type { ConjunctionDto } from "@/dto/http";

function row(
  overrides: Partial<ConjunctionDto> = {},
): ConjunctionDto {
  return {
    id: 1,
    primaryId: 10,
    secondaryId: 20,
    primaryName: "ISS",
    secondaryName: "STARLINK-1000",
    regime: "LEO",
    epoch: "2026-04-22T00:00:00.000Z",
    minRangeKm: 1.5,
    relativeVelocityKmps: 12.3,
    probabilityOfCollision: 1e-5,
    combinedSigmaKm: 0.36,
    hardBodyRadiusM: 15,
    pcMethod: "foster-gaussian",
    computedAt: "2026-04-22T00:00:00.000Z",
    covarianceQuality: "MED",
    action: "monitor",
    ...overrides,
  };
}

describe("useThreatBoard", () => {
  it("filters out conjunctions with invalid geometry before ranking", () => {
    const { result } = renderHook(() =>
      useThreatBoard([
        row({ id: 1, minRangeKm: 0, relativeVelocityKmps: 0, probabilityOfCollision: 4e-4 }),
        row({ id: 2, minRangeKm: 18.89, relativeVelocityKmps: 1.27, probabilityOfCollision: 1e-5 }),
      ]),
    );

    expect(result.current.threats.map((c) => c.id)).toEqual([2]);
    expect(result.current.highCount).toBe(0);
    expect(result.current.peakPc).toBe(1e-5);
    expect(result.current.labelIds).toEqual([10, 20]);
  });
});

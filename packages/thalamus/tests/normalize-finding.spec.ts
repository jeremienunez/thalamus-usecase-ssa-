import { describe, expect, it } from "vitest";
import { ResearchFindingType, ResearchUrgency } from "@interview/shared/enum";
import { normalizeFinding } from "../src/cortices/strategies/helpers";
import type { CortexFinding } from "../src/cortices/types";

function normalize(raw: Record<string, unknown>) {
  return normalizeFinding(raw as Partial<CortexFinding>, "test_cortex");
}

describe("normalizeFinding numeric coercion", () => {
  it("falls back when confidence or impactScore are non-finite", () => {
    expect(normalize({ confidence: Infinity }).confidence).toBe(0.5);
    expect(normalize({ confidence: -Infinity }).confidence).toBe(0.5);
    expect(normalize({ confidence: Number.NaN }).confidence).toBe(0.5);

    expect(normalize({ impactScore: Infinity }).impactScore).toBe(5);
    expect(normalize({ impactScore: -Infinity }).impactScore).toBe(5);
    expect(normalize({ impactScore: Number.NaN }).impactScore).toBe(5);
  });

  it("keeps finite values and existing coercion behavior", () => {
    const fromStrings = normalize({ confidence: "0.75", impactScore: "8" });

    expect(fromStrings.confidence).toBe(0.75);
    expect(fromStrings.impactScore).toBe(8);

    const fromNull = normalize({ confidence: null, impactScore: null });

    expect(fromNull.confidence).toBe(0);
    expect(fromNull.impactScore).toBe(0);
  });

  it("still clamps finite out-of-range values", () => {
    const high = normalize({ confidence: 1.5, impactScore: 12 });
    const low = normalize({ confidence: -0.5, impactScore: -3 });

    expect(high.confidence).toBe(1);
    expect(high.impactScore).toBe(10);
    expect(low.confidence).toBe(0);
    expect(low.impactScore).toBe(0);
  });

  it("preserves default enum normalization while testing partial payloads", () => {
    const out = normalize({});

    expect(out.findingType).toBe(ResearchFindingType.Insight);
    expect(out.urgency).toBe(ResearchUrgency.Medium);
    expect(out.sourceCortex).toBe("test_cortex");
  });
});

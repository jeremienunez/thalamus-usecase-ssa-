import { describe, expect, it } from "vitest";
import {
  buildCycleVerification,
} from "../src/services/cycle-loop.service";
import {
  ResearchEntityType,
  ResearchFindingType,
  ResearchRelation,
  ResearchUrgency,
} from "@interview/shared/enum";

describe("buildCycleVerification", () => {
  it("emits generic verification reasons and entity hints from reflexion + finding edges", () => {
    const verification = buildCycleVerification({
      allFindings: [
        {
          title: "MONITOR: COSMOS 2390 conjunction corridor",
          summary:
            "Continue monitoring over 30 days; telemetry coverage is missing on the primary object.",
          findingType: ResearchFindingType.Alert,
          urgency: ResearchUrgency.High,
          evidence: [],
          confidence: 0.74,
          impactScore: 9,
          sourceCortex: "strategist",
          edges: [
            {
              entityType: ResearchEntityType.ConjunctionEvent,
              entityId: 41,
              relation: ResearchRelation.About,
            },
            {
              entityType: ResearchEntityType.Satellite,
              entityId: 7,
              relation: ResearchRelation.About,
            },
          ],
        },
      ],
      finalReflexion: {
        replan: true,
        notes: "Need another verification pass with a wider horizon.",
        gaps: ["Extend to a 30-day window", "Telemetry gap on the primary satellite"],
        overallConfidence: 0.58,
      },
      lowConfidenceRounds: 1,
      replanCount: 1,
      stopReason: "cost-exhausted",
    });

    expect(verification.needsVerification).toBe(true);
    expect(verification.reasonCodes).toEqual(
      expect.arrayContaining([
        "replan_requested",
        "low_confidence_round",
        "budget_exhausted",
        "low_overall_confidence",
        "horizon_insufficient",
        "needs_monitoring",
        "data_gap",
      ]),
    );
    expect(verification.targetHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: ResearchEntityType.ConjunctionEvent,
          entityId: 41n,
        }),
        expect.objectContaining({
          entityType: ResearchEntityType.Satellite,
          entityId: 7n,
        }),
      ]),
    );
  });

  it("stays empty when the cycle ends cleanly without verification signals", () => {
    const verification = buildCycleVerification({
      allFindings: [
        {
          title: "Stable fleet posture",
          summary: "No further action required.",
          findingType: ResearchFindingType.Insight,
          urgency: ResearchUrgency.Low,
          evidence: [],
          confidence: 0.92,
          impactScore: 2,
          sourceCortex: "strategist",
          edges: [],
        },
      ],
      finalReflexion: {
        replan: false,
        notes: "Sufficient evidence gathered.",
        gaps: [],
        overallConfidence: 0.92,
      },
      lowConfidenceRounds: 0,
      replanCount: 0,
      stopReason: "reflexion_sufficient",
    });

    expect(verification).toEqual({
      needsVerification: false,
      reasonCodes: [],
      targetHints: [],
      confidence: 0.92,
    });
  });
});

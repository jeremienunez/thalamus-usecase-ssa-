import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCycleVerification,
} from "../src/services/cycle-loop.service";
import {
  ResearchFindingType,
  ResearchRelation,
  ResearchUrgency,
} from "@interview/shared/enum";

const realBigInt = globalThis.BigInt;

describe("buildCycleVerification", () => {
  afterEach(() => {
    globalThis.BigInt = realBigInt;
    vi.restoreAllMocks();
  });

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
              entityType: "conjunction_event",
              entityId: 41,
              relation: ResearchRelation.About,
            },
            {
              entityType: "satellite",
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
          entityType: "conjunction_event",
          entityId: 41n,
        }),
        expect.objectContaining({
          entityType: "satellite",
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

  it("deduplicates repeated target hints and flags iteration-limit contradiction follow-up signals", () => {
    const verification = buildCycleVerification({
      allFindings: [
        {
          title: "Conflict in operator reports",
          summary: "Recheck within 7 days because the catalog remains inconsistent.",
          findingType: ResearchFindingType.Alert,
          urgency: ResearchUrgency.High,
          evidence: [],
          confidence: 0.83,
          impactScore: 7,
          sourceCortex: "curator",
          edges: [
            {
              entityType: "satellite",
              entityId: 15,
              relation: ResearchRelation.About,
            },
          ],
        },
        {
          title: "Conflict in operator reports",
          summary: "Same verification target emitted again.",
          findingType: ResearchFindingType.Alert,
          urgency: ResearchUrgency.High,
          evidence: [],
          confidence: 0.8,
          impactScore: 7,
          sourceCortex: "curator",
          edges: [
            {
              entityType: "satellite",
              entityId: 15,
              relation: ResearchRelation.About,
            },
          ],
        },
      ],
      finalReflexion: {
        replan: true,
        notes: "A conflict remains; recheck over a 7-day window.",
        gaps: ["Coverage gap still open"],
        overallConfidence: 1.4,
      },
      lowConfidenceRounds: 0,
      replanCount: 1,
      stopReason: "max-iterations",
    });

    expect(verification.confidence).toBe(1);
    expect(verification.reasonCodes).toEqual(
      expect.arrayContaining([
        "replan_requested",
        "iteration_limit_reached",
        "contradiction_detected",
        "needs_monitoring",
        "horizon_insufficient",
        "data_gap",
      ]),
    );
    expect(verification.targetHints).toEqual([
      {
        entityType: "satellite",
        entityId: 15n,
        sourceCortex: "curator",
        sourceTitle: "Conflict in operator reports",
        confidence: 0.83,
      },
    ]);
  });

  it("filters verification target hints through the domain entity predicate", () => {
    const verification = buildCycleVerification({
      allFindings: [
        {
          title: "Mixed entities",
          summary: "Only one entity type should be surfaced.",
          findingType: ResearchFindingType.Alert,
          urgency: ResearchUrgency.High,
          evidence: [],
          confidence: 0.83,
          impactScore: 7,
          edges: [
            {
              entityType: "satellite",
              entityId: 15,
              relation: ResearchRelation.About,
            },
            {
              entityType: "operator",
              entityId: 3,
              relation: ResearchRelation.About,
            },
          ],
        },
      ],
      finalReflexion: {
        replan: false,
        notes: "Evidence is sufficient.",
        gaps: [],
        overallConfidence: 0.83,
      },
      lowConfidenceRounds: 0,
      replanCount: 0,
      stopReason: "completed",
      isVerificationRelevantEntityType: (entityType) =>
        entityType === "satellite",
    });

    expect(verification.targetHints).toEqual([
      expect.objectContaining({ entityType: "satellite", entityId: 15n }),
    ]);
  });

  it("ignores blank text for pattern matching and clamps non-finite confidence to zero", () => {
    const verification = buildCycleVerification({
      allFindings: [],
      finalReflexion: {
        replan: false,
        notes: "   ",
        gaps: ["   "],
        overallConfidence: Number.NaN,
      },
      lowConfidenceRounds: 0,
      replanCount: 0,
      stopReason: "completed",
    });

    expect(verification).toEqual({
      needsVerification: true,
      reasonCodes: ["low_overall_confidence"],
      targetHints: [],
      confidence: 0,
    });
  });

  it("keeps verification targets when provenance is missing and nullish target keys collapse to a single hint", () => {
    vi.stubGlobal(
      "BigInt",
      (value: number) => (value === 0 ? undefined : realBigInt(value)),
    );

    const malformedEdge = JSON.parse(
      '{"entityType":null,"entityId":0,"relation":"about"}',
    );

    const verification = buildCycleVerification({
      allFindings: [
        {
          title: "Neutral operator note",
          summary: "Escalation is not required.",
          findingType: ResearchFindingType.Insight,
          urgency: ResearchUrgency.Low,
          evidence: [],
          confidence: 0.81,
          impactScore: 1,
          edges: [malformedEdge, malformedEdge],
        },
      ],
      finalReflexion: {
        replan: false,
        notes: "Evidence is sufficient.",
        gaps: [],
        overallConfidence: 0.81,
      },
      lowConfidenceRounds: 0,
      replanCount: 0,
      stopReason: "completed",
    });

    expect(verification).toEqual({
      needsVerification: true,
      reasonCodes: [],
      targetHints: [
        {
          entityType: null,
          entityId: undefined,
          sourceCortex: null,
          sourceTitle: "Neutral operator note",
          confidence: 0.81,
        },
      ],
      confidence: 0.81,
    });
  });

  it("clamps negative confidence to zero", () => {
    const verification = buildCycleVerification({
      allFindings: [],
      finalReflexion: {
        replan: false,
        notes: "Evidence closed.",
        gaps: [],
        overallConfidence: -0.2,
      },
      lowConfidenceRounds: 0,
      replanCount: 0,
      stopReason: "completed",
    });

    expect(verification).toEqual({
      needsVerification: true,
      reasonCodes: ["low_overall_confidence"],
      targetHints: [],
      confidence: 0,
    });
  });
});

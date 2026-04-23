import { describe, expect, it } from "vitest";
import {
  ResearchFindingType,
  ResearchUrgency,
} from "@interview/shared/enum";
import type { CortexFinding, DAGPlan } from "../src/cortices/types";
import {
  THALAMUS_CONFIG,
  noveltyThreshold,
  type IterationBudget,
} from "../src/cortices/config";
import { StopCriteriaEvaluator } from "../src/services/stop-criteria.service";

function makeBudget(
  overrides: Partial<IterationBudget> = {},
): IterationBudget {
  return {
    maxIterations: 4,
    maxCost: 0.06,
    confidenceTarget: 0.8,
    coverageTarget: 0.75,
    minFindingsToStop: 2,
    ...overrides,
  };
}

function makePlan(cortices: string[]): DAGPlan {
  return {
    intent: "test intent",
    complexity: "moderate",
    nodes: cortices.map((cortex) => ({
      cortex,
      params: {},
      dependsOn: [],
    })),
  };
}

function makeFinding(
  overrides: Partial<CortexFinding> = {},
): CortexFinding {
  return {
    title: "Nominal finding",
    summary: "Nominal summary",
    findingType: ResearchFindingType.Insight,
    urgency: ResearchUrgency.Low,
    evidence: [],
    confidence: 0.9,
    impactScore: 4,
    edges: [],
    ...overrides,
  };
}

describe("StopCriteriaEvaluator.shouldStop", () => {
  it("stops on consecutive zero runs before evaluating later stop checks", () => {
    const evaluator = new StopCriteriaEvaluator();

    const decision = evaluator.shouldStop({
      iteration: 3,
      totalCost: 0.9,
      maxCost: 0.5,
      consecutiveZeroRuns: THALAMUS_CONFIG.loop.consecutiveZeroStop,
      consecutiveIdenticalGaps: 2,
      allFindings: [makeFinding()],
      kept: [makeFinding()],
      plan: makePlan(["strategist"]),
      budget: makeBudget(),
    });

    expect(decision).toEqual({
      stop: true,
      reason: "consecutive-zero-runs",
    });
  });

  it("stops on exhausted cost before the repeated-gap plateau check", () => {
    const evaluator = new StopCriteriaEvaluator();

    const decision = evaluator.shouldStop({
      iteration: 2,
      totalCost: 0.25,
      maxCost: 0.25,
      consecutiveZeroRuns: 1,
      consecutiveIdenticalGaps: 2,
      allFindings: [makeFinding()],
      kept: [makeFinding()],
      plan: makePlan(["strategist"]),
      budget: makeBudget(),
    });

    expect(decision).toEqual({
      stop: true,
      reason: "cost-exhausted",
    });
  });

  it("stops on repeated reflexion gaps before eagerness can approve the loop", () => {
    const evaluator = new StopCriteriaEvaluator();

    const decision = evaluator.shouldStop({
      iteration: 3,
      totalCost: 0.02,
      maxCost: 0.5,
      consecutiveZeroRuns: 0,
      consecutiveIdenticalGaps: 2,
      allFindings: [
        makeFinding({ sourceCortex: "strategist", title: "shared-title-a" }),
        makeFinding({ sourceCortex: "scout", title: "shared-title-b" }),
      ],
      kept: [
        makeFinding({ sourceCortex: "strategist", title: "shared-title-a" }),
        makeFinding({ sourceCortex: "scout", title: "shared-title-b" }),
      ],
      plan: makePlan(["strategist", "scout"]),
      budget: makeBudget({
        confidenceTarget: 0.5,
        coverageTarget: 1,
        minFindingsToStop: 2,
      }),
    });

    expect(decision).toEqual({
      stop: true,
      reason: "gap-plateau",
    });
  });

  it("stops on eagerness once confidence coverage and low novelty all align", () => {
    const evaluator = new StopCriteriaEvaluator();
    const repeatedPrefixA = "launch-corridor-repeat".padEnd(40, "a");
    const repeatedPrefixB = "thermal-drift-repeat".padEnd(40, "b");

    const decision = evaluator.shouldStop({
      iteration: 3,
      totalCost: 0.02,
      maxCost: 0.5,
      consecutiveZeroRuns: 0,
      consecutiveIdenticalGaps: 0,
      allFindings: [
        makeFinding({
          sourceCortex: "strategist",
          confidence: 0.91,
          title: `${repeatedPrefixA} old`,
        }),
        makeFinding({
          sourceCortex: "scout",
          confidence: 0.87,
          title: `${repeatedPrefixB} old`,
        }),
        makeFinding({
          confidence: 0.9,
          title: `${repeatedPrefixA} new`,
        }),
        makeFinding({
          sourceCortex: "curator",
          confidence: 0.88,
          title: `${repeatedPrefixB} new`,
        }),
      ],
      kept: [
        makeFinding({
          confidence: 0.9,
          title: `${repeatedPrefixA} new`,
        }),
        makeFinding({
          sourceCortex: "curator",
          confidence: 0.88,
          title: `${repeatedPrefixB} new`,
        }),
      ],
      plan: makePlan(["strategist", "scout", "curator", "verifier"]),
      budget: makeBudget({
        confidenceTarget: 0.85,
        coverageTarget: 1,
        minFindingsToStop: 4,
      }),
    });

    expect(decision).toEqual({
      stop: true,
      reason: "eagerness-satisfied",
      metrics: {
        avgConfidence: 0.89,
        coverageRatio: 1,
        noveltyRatio: 0,
        noveltyThreshold: noveltyThreshold(3),
        corticesWithFindings: 4,
        totalCorticesInPlan: 4,
        novelFindings: 0,
      },
    });
  });

  it("keeps running with zeroed metrics when no findings or planned cortices exist yet", () => {
    const evaluator = new StopCriteriaEvaluator();

    const decision = evaluator.shouldStop({
      iteration: 1,
      totalCost: 0.01,
      maxCost: 0.5,
      consecutiveZeroRuns: 0,
      consecutiveIdenticalGaps: 0,
      allFindings: [],
      kept: [],
      plan: makePlan([]),
      budget: makeBudget(),
    });

    expect(decision).toEqual({
      stop: false,
      metrics: {
        avgConfidence: 0,
        coverageRatio: 0,
        noveltyRatio: 0,
        noveltyThreshold: noveltyThreshold(1),
        corticesWithFindings: 0,
        totalCorticesInPlan: 0,
        novelFindings: 0,
      },
    });
  });
});

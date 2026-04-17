/**
 * Stop Criteria Evaluator — Pure stop-condition logic for the research loop.
 *
 * Extracted from `ThalamusService.runCycle` to uphold SRP. No side effects.
 * Given loop state, decides whether to stop and returns a reason for logging.
 */

import { THALAMUS_CONFIG, noveltyThreshold } from "../cortices/config";
import type { IterationBudget } from "../cortices/config";
import type { CortexFinding } from "../cortices/types";
import type { DAGPlan } from "./thalamus-planner.service";

export interface StopEvaluationState {
  iteration: number;
  totalCost: number;
  maxCost: number;
  consecutiveZeroRuns: number;
  /**
   * Count of consecutive reflexion rounds that produced the same gap set —
   * signals the replan loop is stuck asking for data that never arrives.
   */
  consecutiveIdenticalGaps: number;
  allFindings: CortexFinding[];
  kept: CortexFinding[];
  plan: DAGPlan;
  budget: IterationBudget;
}

export interface StopDecision {
  stop: boolean;
  reason?:
    | "consecutive-zero-runs"
    | "cost-exhausted"
    | "eagerness-satisfied"
    | "gap-plateau";
  metrics?: {
    avgConfidence: number;
    coverageRatio: number;
    noveltyRatio: number;
    noveltyThreshold: number;
    corticesWithFindings: number;
    totalCorticesInPlan: number;
    novelFindings: number;
  };
}

/** Two identical reflexion-gap rounds in a row = plateau, force stop. */
const GAP_PLATEAU_STOP = 2;

export class StopCriteriaEvaluator {
  /**
   * Evaluate all stop conditions against the current loop state.
   * Order mirrors the original `ThalamusService.runCycle` loop:
   *   1. consecutive-zero-runs
   *   2. cost budget exhausted
   *   3. eagerness (confidence + coverage + novelty decline)
   */
  shouldStop(state: StopEvaluationState): StopDecision {
    // 1. Consecutive zero-finding runs
    if (
      state.consecutiveZeroRuns >= THALAMUS_CONFIG.loop.consecutiveZeroStop
    ) {
      return { stop: true, reason: "consecutive-zero-runs" };
    }

    // 2. Cost budget
    if (state.totalCost >= state.maxCost) {
      return { stop: true, reason: "cost-exhausted" };
    }

    // 3. Gap plateau — reflexion keeps asking for the same missing data
    if (state.consecutiveIdenticalGaps >= GAP_PLATEAU_STOP) {
      return { stop: true, reason: "gap-plateau" };
    }

    // 4. Eagerness — 3 dimensions: confidence, coverage, novelty
    const { allFindings, kept, plan, budget, iteration } = state;

    const avgConfidence =
      allFindings.length > 0
        ? allFindings.reduce((s, f) => s + f.confidence, 0) / allFindings.length
        : 0;

    // Coverage: how many DISTINCT cortices produced findings?
    // (`sourceCortex` is stamped by normalizeFinding; fall back to "unknown"
    // for findings created outside the strategy pipeline.)
    const corticesWithFindings = new Set(
      allFindings.map((f) => f.sourceCortex ?? "unknown"),
    ).size;
    const totalCorticesInPlan = new Set(plan.nodes.map((n) => n.cortex)).size;
    const coverageRatio =
      totalCorticesInPlan > 0 ? corticesWithFindings / totalCorticesInPlan : 0;

    // Novelty: how many findings in THIS iteration are truly new?
    const prevTitles = new Set(
      allFindings
        .slice(0, -kept.length || 0)
        .map((f) => f.title.toLowerCase().slice(0, 40)),
    );
    const novelFindings = kept.filter(
      (f) => !prevTitles.has(f.title.toLowerCase().slice(0, 40)),
    ).length;
    const noveltyRatio = kept.length > 0 ? novelFindings / kept.length : 0;
    const novThreshold = noveltyThreshold(iteration);

    const eagernessSatisfied =
      avgConfidence >= budget.confidenceTarget &&
      allFindings.length >= budget.minFindingsToStop &&
      coverageRatio >= budget.coverageTarget &&
      noveltyRatio < novThreshold;

    const metrics = {
      avgConfidence,
      coverageRatio,
      noveltyRatio,
      noveltyThreshold: novThreshold,
      corticesWithFindings,
      totalCorticesInPlan,
      novelFindings,
    };

    if (eagernessSatisfied) {
      return { stop: true, reason: "eagerness-satisfied", metrics };
    }

    return { stop: false, metrics };
  }
}

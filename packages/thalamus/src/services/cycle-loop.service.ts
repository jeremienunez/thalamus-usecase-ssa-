/**
 * Cycle Loop Runner — Recursive research loop (Karpathy autoresearch pattern).
 *
 * Extracted from `ThalamusService.runCycle` to uphold SRP + DIP: consumes
 * executor / reflexion / planner / stop-criteria as injected ports and
 * returns the accumulated findings, cost and iteration count.
 */

import { createLogger } from "@interview/shared/observability";
import type { IterationBudget } from "../cortices/config";
import type { CortexFinding } from "../cortices/types";
import type { ThalamusDAGExecutor } from "./thalamus-executor.service";
import type {
  ReflexionResult,
  ThalamusReflexion,
} from "./thalamus-reflexion.service";
import type { ThalamusPlanner, DAGPlan } from "./thalamus-planner.service";
import type { StopCriteriaEvaluator } from "./stop-criteria.service";
import type {
  ResearchCycleVerification,
  ResearchVerificationTargetHint,
} from "../types/research.types";

const logger = createLogger("cycle-loop");

export interface IterationContext {
  /** Minimum confidence to keep a finding (default 0.7). */
  minConfidence?: number;
  lang?: "fr" | "en";
  mode?: "investment" | "audit";
  userId?: bigint;
  /** Original user query — used to build replan prompts. */
  query: string;
  /** Whether a user is in scope — drives filtering of user-scoped cortices. */
  hasUser?: boolean;
}

export interface CycleLoopBudget {
  maxIter: number;
  maxCost: number;
  budget: IterationBudget;
}

export interface CycleLoopResult {
  allFindings: CortexFinding[];
  totalCost: number;
  iterations: number;
  finalPlan: DAGPlan;
  verification: ResearchCycleVerification;
}

export class CycleLoopRunner {
  constructor(
    private dagExecutor: ThalamusDAGExecutor,
    private reflexion: ThalamusReflexion,
    private planner: ThalamusPlanner,
    private stopCriteria: StopCriteriaEvaluator,
  ) {}

  /**
   * Run the recursive research loop until a stop condition fires or the
   * iteration budget is exhausted.
   */
  async run(
    initialPlan: DAGPlan,
    cycleId: bigint,
    loopBudget: CycleLoopBudget,
    ctx: IterationContext,
  ): Promise<CycleLoopResult> {
    const { maxIter, maxCost, budget } = loopBudget;

    const allFindings: CortexFinding[] = [];
    let iteration = 0;
    let totalCost = 0;
    let consecutiveZeroRuns = 0;
    let consecutiveIdenticalGaps = 0;
    let lastGapSignature: string | null = null;
    let lastReflexion: ReflexionResult | null = null;
    let lowConfidenceRounds = 0;
    let replanCount = 0;
    let stopReason = "completed";
    let currentPlan = initialPlan;

    while (iteration < maxIter) {
      iteration++;

      // 1. Execute DAG
      const { outputs } = await this.dagExecutor.execute(
        currentPlan,
        cycleId,
        ctx.lang,
        ctx.mode,
        ctx.userId,
      );
      const newFindings = [...outputs.values()].flatMap((o) => o.findings);
      const iterationCost = [...outputs.values()].reduce(
        (sum, o) => sum + o.metadata.tokensUsed * 0.000002,
        0,
      );
      totalCost += iterationCost;

      // 2. Keep/Discard — only keep findings above confidence threshold
      const minConf = ctx.minConfidence ?? 0.7;
      const kept = newFindings.filter((f) => f.confidence >= minConf);
      const discarded = newFindings.length - kept.length;
      allFindings.push(...kept);

      logger.info(
        {
          iteration,
          newFindings: newFindings.length,
          kept: kept.length,
          discarded,
          totalFindings: allFindings.length,
          cost: totalCost.toFixed(4),
        },
        "Research loop iteration complete",
      );

      // 3. Track consecutive zero-finding runs
      if (kept.length === 0) {
        consecutiveZeroRuns++;
        if (newFindings.length > 0) lowConfidenceRounds++;
      } else {
        consecutiveZeroRuns = 0;
      }

      // 4. Evaluate stop conditions (pure)
      const decision = this.stopCriteria.shouldStop({
        iteration,
        totalCost,
        maxCost,
        consecutiveZeroRuns,
        consecutiveIdenticalGaps,
        allFindings,
        kept,
        plan: currentPlan,
        budget,
      });

      if (decision.metrics) {
        logger.info(
          {
            iteration,
            complexity: initialPlan.complexity,
            avgConfidence: decision.metrics.avgConfidence.toFixed(2),
            coverage: `${decision.metrics.corticesWithFindings}/${decision.metrics.totalCorticesInPlan}`,
            novelty: `${decision.metrics.novelFindings}/${kept.length} (threshold: ${decision.metrics.noveltyThreshold.toFixed(2)})`,
            shouldStop: decision.stop,
          },
          "Eagerness evaluation",
        );
      }

      if (decision.stop) {
        stopReason = decision.reason;
        logger.info({ iteration, reason: decision.reason }, "Stopping loop");
        break;
      }

      // 5. Reflexion — should we iterate? What's missing?
      if (iteration < maxIter) {
        const reflexionResult = await this.reflexion.evaluate(
          currentPlan.intent,
          newFindings,
          allFindings,
          iteration,
          {
            complexity: initialPlan.complexity,
            remainingBudget: maxCost - totalCost,
            maxIterations: maxIter,
          },
        );
        lastReflexion = reflexionResult;

        if (!reflexionResult.replan) {
          stopReason = "reflexion_sufficient";
          logger.info(
            { iteration, notes: reflexionResult.notes },
            "Reflexion: sufficient",
          );
          break;
        }
        replanCount++;

        // Plateau detection — if reflexion keeps asking for the same gaps
        // two rounds in a row, the next iteration will not help.
        const gapSignature = (reflexionResult.gaps ?? [])
          .map((g) => g.trim().toLowerCase())
          .sort()
          .join("|");
        if (gapSignature && gapSignature === lastGapSignature) {
          consecutiveIdenticalGaps++;
        } else {
          consecutiveIdenticalGaps = 0;
        }
        lastGapSignature = gapSignature;

        // Replan with accumulated context
        const gaps = reflexionResult.gaps?.join(", ") ?? "need more evidence";
        const prevFindingTitles = allFindings.map((f) => f.title).join("; ");
        const refinedQuery = `${ctx.query}\n\nIteration ${iteration}. Previous findings: ${prevFindingTitles}\nGaps: ${gaps}`;

        logger.info({ gaps, iteration }, "Reflexion: replanning");
        currentPlan = await this.planner.plan(refinedQuery, {
          hasUser: ctx.hasUser,
        });
      }
    }

    return {
      allFindings,
      totalCost,
      iterations: iteration,
      finalPlan: currentPlan,
      verification: buildCycleVerification({
        allFindings,
        finalReflexion: lastReflexion,
        lowConfidenceRounds,
        replanCount,
        stopReason,
      }),
    };
  }
}

interface VerificationBuildInput {
  allFindings: CortexFinding[];
  finalReflexion: ReflexionResult | null;
  lowConfidenceRounds: number;
  replanCount: number;
  stopReason: string;
}

export function buildCycleVerification(
  input: VerificationBuildInput,
): ResearchCycleVerification {
  const reasonCodes = new Set<string>();
  const targetKeySet = new Set<string>();
  const targetHints: ResearchVerificationTargetHint[] = [];
  const avgConfidence =
    input.allFindings.length === 0
      ? 0
      : input.allFindings.reduce((sum, f) => sum + f.confidence, 0) /
        input.allFindings.length;
  const confidence = clamp01(
    input.finalReflexion?.overallConfidence ?? avgConfidence,
  );

  if (input.replanCount > 0) reasonCodes.add("replan_requested");
  if (input.lowConfidenceRounds > 0) reasonCodes.add("low_confidence_round");
  if (input.stopReason === "cost-exhausted") reasonCodes.add("budget_exhausted");
  if (input.stopReason === "max-iterations") reasonCodes.add("iteration_limit_reached");
  if (confidence < 0.65) reasonCodes.add("low_overall_confidence");

  const gapText = (input.finalReflexion?.gaps ?? []).join(" | ");
  const notesText = input.finalReflexion?.notes ?? "";
  const reflexionText = `${gapText} | ${notesText}`;
  if (matches(reflexionText, /\b(horizon|window|30 ?jours|30-day|30 day|week|weeks|days)\b/i)) {
    reasonCodes.add("horizon_insufficient");
  }
  if (matches(reflexionText, /\b(monitor|surveil|follow[- ]?up|continue|corroborat|widen|verify|recheck)\b/i)) {
    reasonCodes.add("needs_monitoring");
  }
  if (matches(reflexionText, /\b(contradict|inconsisten|conflict)\b/i)) {
    reasonCodes.add("contradiction_detected");
  }
  if (matches(reflexionText, /\b(missing|gap|coverage|catalog)\b/i)) {
    reasonCodes.add("data_gap");
  }

  for (const finding of input.allFindings) {
    const findingText = `${finding.title} ${finding.summary}`;
    if (matches(findingText, /\b(monitor|surveil|follow[- ]?up|continue|corroborat|widen)\b/i)) {
      reasonCodes.add("needs_monitoring");
    }
    if (matches(findingText, /\b(30 ?jours|30-day|30 day|week|weeks|days)\b/i)) {
      reasonCodes.add("horizon_insufficient");
    }
    if (matches(findingText, /\b(missing|gap|coverage|catalog)\b/i)) {
      reasonCodes.add("data_gap");
    }

    // Every edge is a verification target. Domain decides via its own
    // cortex whether a specific entity type is worth surfacing — kernel
    // stays agnostic over SSA/threat-intel/etc. vocabulary.
    for (const edge of finding.edges) {
      pushVerificationTarget(
        targetKeySet,
        targetHints,
        {
          entityType: edge.entityType,
          entityId: BigInt(edge.entityId),
          sourceCortex: finding.sourceCortex ?? null,
          sourceTitle: finding.title,
          confidence: finding.confidence,
        },
      );
    }
  }

  const needsVerification =
    reasonCodes.size > 0 || targetHints.length > 0;

  return {
    needsVerification,
    reasonCodes: [...reasonCodes],
    targetHints,
    confidence,
  };
}

function pushVerificationTarget(
  seen: Set<string>,
  acc: ResearchVerificationTargetHint[],
  hint: ResearchVerificationTargetHint,
): void {
  const key = [
    hint.entityType ?? "none",
    hint.entityId?.toString() ?? "none",
  ].join(":");
  if (seen.has(key)) return;
  seen.add(key);
  acc.push(hint);
}

function matches(text: string, pattern: RegExp): boolean {
  return text.trim().length > 0 && pattern.test(text);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

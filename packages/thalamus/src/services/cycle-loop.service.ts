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
import type { ThalamusReflexion } from "./thalamus-reflexion.service";
import type { ThalamusPlanner, DAGPlan } from "./thalamus-planner.service";
import type { StopCriteriaEvaluator } from "./stop-criteria.service";

const logger = createLogger("cycle-loop");

export interface IterationContext {
  /** Minimum confidence to keep a finding (default 0.7). */
  minConfidence?: number;
  lang?: "fr" | "en";
  mode?: "investment" | "audit";
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
    let currentPlan = initialPlan;

    while (iteration < maxIter) {
      iteration++;

      // 1. Execute DAG
      const { outputs } = await this.dagExecutor.execute(
        currentPlan,
        cycleId,
        ctx.lang,
        ctx.mode,
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

        if (!reflexionResult.replan) {
          logger.info(
            { iteration, notes: reflexionResult.notes },
            "Reflexion: sufficient",
          );
          break;
        }

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
    };
  }
}

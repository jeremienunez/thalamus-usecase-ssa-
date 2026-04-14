/**
 * Thalamus Service — Main orchestrator for autonomous SSA research
 *
 * Planner → DAG Executor → Reflexion → Knowledge Graph
 *
 * Two modes:
 * - Daemon: predefined DAGs, Kimi K2 only, no reflexion
 * - User: LLM-planned DAGs, optional reflexion, full cycle
 */

import { createLogger } from "@interview/shared/observability";
import {
  THALAMUS_CONFIG,
  ITERATION_BUDGETS,
  noveltyThreshold,
} from "../cortices/config";
import {
  ResearchCycleTrigger,
  ResearchCycleStatus,
  ResearchStatus,
} from "@interview/shared/enum";
import type { CortexRegistry } from "../cortices/registry";
import type { CortexExecutor } from "../cortices/executor";
import type { ResearchGraphService } from "./research-graph.service";
import type { ResearchCycleRepository } from "../repositories/research-cycle.repository";
import type { ResearchCycle } from "../entities/research.entity";
import { ThalamusPlanner, type DAGPlan } from "./thalamus-planner.service";
import { ThalamusDAGExecutor } from "./thalamus-executor.service";
import { ThalamusReflexion } from "./thalamus-reflexion.service";

const logger = createLogger("thalamus");

export interface RunCycleInput {
  query: string;
  userId?: bigint;
  triggerType: ResearchCycleTrigger;
  triggerSource?: string;
  cortices?: string[];
  /** Pre-built DAG — bypasses planner entirely when provided */
  dag?: DAGPlan;
  /** Minimum confidence to keep a finding (default 0.7) */
  minConfidence?: number;
  /** Override entity edges — inject correct DB IDs the LLM can't know */
  entityOverride?: { entityType: string; entityId: bigint };
  daemonJob?: string;
  lang?: "fr" | "en";
  mode?: "investment" | "audit";
}

export class ThalamusService {
  private planner: ThalamusPlanner;
  private dagExecutor: ThalamusDAGExecutor;
  private reflexion: ThalamusReflexion;

  constructor(
    private registry: CortexRegistry,
    private cortexExecutor: CortexExecutor,
    private graphService: ResearchGraphService,
    private cycleRepo: ResearchCycleRepository,
  ) {
    this.planner = new ThalamusPlanner(registry);
    this.dagExecutor = new ThalamusDAGExecutor(cortexExecutor);
    this.reflexion = new ThalamusReflexion();
  }

  /**
   * Run a full research cycle: plan → execute → reflect → store.
   * Returns the cycle record with findings count.
   */
  async runCycle(input: RunCycleInput): Promise<ResearchCycle> {
    // 1. Get DAG plan
    let plan: DAGPlan;
    if (input.dag) {
      // Caller provided a pre-built DAG — use it directly (no planner LLM call)
      plan = input.dag;
    } else if (input.daemonJob) {
      plan = this.planner.getDaemonDag(input.daemonJob) ?? {
        intent: input.query,
        complexity: "moderate" as const,
        nodes: [],
      };
    } else {
      plan = await this.planner.plan(input.query);
    }

    if (plan.nodes.length === 0) {
      logger.warn({ query: input.query }, "Empty DAG plan, aborting cycle");
      throw new Error("Planner produced empty DAG — no cortices to activate");
    }

    // 2. Create cycle record
    const cycle = await this.cycleRepo.create({
      triggerType: input.triggerType,
      triggerSource: input.triggerSource ?? input.query,
      userId: input.userId,
      dagPlan: plan,
      corticesUsed: plan.nodes.map((n) => n.cortex),
      status: ResearchCycleStatus.Running,
    });

    logger.info(
      {
        cycleId: cycle.id,
        intent: plan.intent,
        cortices: plan.nodes.map((n) => n.cortex),
        trigger: input.triggerType,
      },
      "Research cycle started",
    );

    try {
      // ================================================================
      // Recursive Research Loop (Karpathy autoresearch pattern)
      // Run → Evaluate → Keep/Discard → Iterate until sufficient
      // ================================================================

      const allFindings: CortexFinding[] = [];
      let iteration = 0;
      let totalCost = 0;
      let consecutiveZeroRuns = 0;
      let currentPlan = plan;

      // Complexity-based iteration budget (falls back to moderate)
      const budget =
        ITERATION_BUDGETS[plan.complexity] ?? ITERATION_BUDGETS.moderate;
      const maxIter = Math.min(
        budget.maxIterations,
        THALAMUS_CONFIG.loop.maxIterationsPerChain,
      );
      const maxCost = Math.min(
        budget.maxCost,
        THALAMUS_CONFIG.loop.maxCostPerChain,
      );

      logger.info(
        {
          complexity: plan.complexity,
          maxIter,
          maxCost,
          confidenceTarget: budget.confidenceTarget,
        },
        "Iteration budget set",
      );

      while (iteration < maxIter) {
        iteration++;

        // 3a. Execute DAG
        const { outputs } = await this.dagExecutor.execute(
          currentPlan,
          cycle.id,
          input.lang,
          input.mode,
        );
        const newFindings = [...outputs.values()].flatMap((o) => o.findings);
        const iterationCost = [...outputs.values()].reduce(
          (sum, o) => sum + o.metadata.tokensUsed * 0.000002,
          0,
        );
        totalCost += iterationCost;

        // 3b. Keep/Discard — only keep findings above confidence threshold
        const minConf = input.minConfidence ?? 0.7;
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

        // 3c. Check stop conditions
        if (kept.length === 0) {
          consecutiveZeroRuns++;
          if (consecutiveZeroRuns >= THALAMUS_CONFIG.loop.consecutiveZeroStop) {
            logger.info(
              { iteration },
              "Stopping: consecutive zero-finding iterations",
            );
            break;
          }
        } else {
          consecutiveZeroRuns = 0;
        }

        // Budget check (complexity-aware)
        if (totalCost >= maxCost) {
          logger.info(
            { totalCost, maxCost, iteration },
            "Stopping: cost budget exhausted",
          );
          break;
        }

        // Eagerness check — 3 dimensions: confidence, coverage, novelty
        const avgConfidence =
          allFindings.length > 0
            ? allFindings.reduce((s, f) => s + f.confidence, 0) /
              allFindings.length
            : 0;

        // Coverage: how many DISTINCT cortices produced findings?
        const corticesWithFindings = new Set(
          allFindings.map((f) => f.edges?.[0]?.entityType ?? "unknown"),
        ).size;
        const totalCorticesInPlan = new Set(
          currentPlan.nodes.map((n) => n.cortex),
        ).size;
        const coverageRatio =
          totalCorticesInPlan > 0
            ? corticesWithFindings / totalCorticesInPlan
            : 0;

        // Novelty: how many findings in THIS iteration are truly new?
        // Diminishing returns: threshold rises with iteration count
        const prevTitles = new Set(
          allFindings
            .slice(0, -kept.length)
            .map((f) => f.title.toLowerCase().slice(0, 40)),
        );
        const novelFindings = kept.filter(
          (f) => !prevTitles.has(f.title.toLowerCase().slice(0, 40)),
        ).length;
        const noveltyRatio = kept.length > 0 ? novelFindings / kept.length : 0;
        const novThreshold = noveltyThreshold(iteration);

        // Eagerness: all 3 must be satisfied to stop early
        const shouldStop =
          avgConfidence >= budget.confidenceTarget &&
          allFindings.length >= budget.minFindingsToStop &&
          coverageRatio >= budget.coverageTarget &&
          noveltyRatio < novThreshold;

        logger.info(
          {
            iteration,
            complexity: plan.complexity,
            avgConfidence: avgConfidence.toFixed(2),
            coverage: `${corticesWithFindings}/${totalCorticesInPlan}`,
            novelty: `${novelFindings}/${kept.length} (threshold: ${novThreshold.toFixed(2)})`,
            shouldStop,
          },
          "Eagerness evaluation",
        );

        if (shouldStop) {
          logger.info(
            { iteration },
            "Stopping: confident + covered + novelty declining",
          );
          break;
        }

        // 3d. Reflexion — should we iterate? What's missing?
        if (iteration < maxIter) {
          // Pass BOTH raw (every finding this iteration emitted) and kept
          // (high-confidence survivors accumulated across iterations).
          // Low-confidence rounds are a replan signal, not a stop signal.
          const reflexionResult = await this.reflexion.evaluate(
            currentPlan.intent,
            newFindings,
            allFindings,
            iteration,
            {
              complexity: plan.complexity,
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

          // Replan with accumulated context
          const gaps = reflexionResult.gaps?.join(", ") ?? "need more evidence";
          const prevFindingTitles = allFindings.map((f) => f.title).join("; ");
          const refinedQuery = `${input.query}\n\nIteration ${iteration}. Previous findings: ${prevFindingTitles}\nGaps: ${gaps}`;

          logger.info({ gaps, iteration }, "Reflexion: replanning");
          currentPlan = await this.planner.plan(refinedQuery);
        }
      }

      // 5. Store findings in knowledge graph
      let storedCount = 0;
      for (const finding of allFindings) {
        try {
          await this.graphService.storeFinding({
            finding: {
              cortex: findingCortex(finding, plan),
              findingType: finding.findingType,
              title: finding.title,
              summary: finding.summary,
              evidence: finding.evidence,
              reasoning: null,
              confidence: finding.confidence,
              impactScore: finding.impactScore,
              urgency: finding.urgency,
              busContext: finding.busContext ?? null,
              researchCycleId: cycle.id,
              reflexionNotes: null,
              iteration,
              status: ResearchStatus.Active,
              expiresAt: computeTTL(finding.confidence),
            },
            edges: input.entityOverride
              ? [
                  {
                    entityType: input.entityOverride.entityType,
                    entityId: input.entityOverride.entityId,
                    relation: "about",
                    weight: 1.0,
                    context: null,
                  },
                ]
              : finding.edges.map((e) => ({
                  entityType: e.entityType,
                  entityId: BigInt(e.entityId),
                  relation: e.relation,
                  weight: 1.0,
                  context: e.context ?? null,
                })),
          });
          storedCount++;
        } catch (err) {
          logger.error(
            { finding: finding.title, err },
            "Failed to store finding",
          );
        }
      }

      // 6. Complete cycle
      await this.cycleRepo.updateStatus(
        cycle.id,
        ResearchCycleStatus.Completed,
        {
          completedAt: new Date(),
          totalCost,
        },
      );

      logger.info(
        {
          cycleId: cycle.id,
          findings: storedCount,
          iterations: iteration,
          cost: totalCost.toFixed(4),
        },
        "Research cycle completed",
      );

      // Refresh cycle with updated counts
      return (await this.cycleRepo.findById(cycle.id))!;
    } catch (err) {
      await this.cycleRepo.updateStatus(cycle.id, ResearchCycleStatus.Failed, {
        error: err instanceof Error ? err.message : String(err),
      });
      logger.error({ cycleId: cycle.id, err }, "Research cycle failed");
      throw err;
    }
  }

  /**
   * Run daemon job by name (predefined DAG, no reflexion).
   */
  async runDaemonJob(jobName: string): Promise<ResearchCycle> {
    return this.runCycle({
      query: `Daemon job: ${jobName}`,
      triggerType: ResearchCycleTrigger.Daemon,
      triggerSource: jobName,
      daemonJob: jobName,
      lang: "fr",
      mode: "audit",
    });
  }

  /**
   * Expire old findings and clean orphan edges.
   */
  async maintenance(): Promise<{ expired: number; orphans: number }> {
    return this.graphService.expireAndClean();
  }
}

// ============================================================================
// Helpers
// ============================================================================

import type { CortexFinding } from "../cortices/types";
import { ResearchCortex } from "@interview/shared/enum";

/**
 * Derive which cortex produced a finding from the DAG plan.
 * CortexFinding doesn't carry its source cortex, so we match
 * by checking DAG node order (findings come out in DAG execution order).
 */
function findingCortex(_finding: CortexFinding, plan: DAGPlan): ResearchCortex {
  // Best effort: use first cortex in the plan as default
  const first = plan.nodes[0]?.cortex;
  if (
    first &&
    Object.values(ResearchCortex).includes(first as ResearchCortex)
  ) {
    return first as ResearchCortex;
  }
  return ResearchCortex.FleetAnalyst;
}

/**
 * TTL based on confidence:
 * - confidence < 0.5 → 14 days
 * - confidence 0.5-0.7 → 30 days
 * - confidence 0.7-0.85 → 60 days
 * - confidence > 0.85 → 90 days
 */
function computeTTL(confidence: number): Date {
  const days =
    confidence < 0.5 ? 14 : confidence < 0.7 ? 30 : confidence < 0.85 ? 60 : 90;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

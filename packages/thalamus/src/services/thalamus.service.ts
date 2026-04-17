/**
 * Thalamus Service — Thin orchestrator for autonomous SSA research.
 *
 * Resolves a DAG plan, delegates the recursive loop to `CycleLoopRunner`,
 * delegates persistence to `FindingPersister`, then updates the cycle
 * record. All heavy logic (loop, stop rules, storage) lives in injected
 * collaborators; this file only composes them.
 *
 * Two modes:
 * - Daemon: predefined DAGs, Kimi K2 only, no reflexion
 * - User: LLM-planned DAGs, optional reflexion, full cycle
 */

import { createLogger, stepLog } from "@interview/shared/observability";
import {
  THALAMUS_CONFIG,
  ITERATION_BUDGETS,
} from "../cortices/config";
import {
  ResearchCycleTrigger,
  ResearchCycleStatus,
} from "@interview/shared/enum";
import type { ResearchGraphService } from "./research-graph.service";
import type {
  ResearchCycle,
  NewResearchCycle,
} from "../types/research.types";
import type { ThalamusPlanner, DAGPlan } from "./thalamus-planner.service";
import type { CycleLoopRunner } from "./cycle-loop.service";
import type { FindingPersister } from "./finding-persister.service";

// ── Port (structural — repo satisfies this by duck typing) ────────
export interface CyclesPort {
  create(data: NewResearchCycle): Promise<ResearchCycle>;
  findById(id: bigint): Promise<ResearchCycle | null>;
  updateStatus(
    id: bigint,
    status: ResearchCycleStatus,
    opts?: { completedAt?: Date; error?: string; totalCost?: number },
  ): Promise<void>;
}

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
  constructor(
    private planner: ThalamusPlanner,
    private cycleLoop: CycleLoopRunner,
    private persister: FindingPersister,
    private cycleRepo: CyclesPort,
    private graphService: ResearchGraphService,
  ) {}

  /**
   * Run a full research cycle: plan → loop (execute + reflect) → store.
   * Returns the cycle record with findings count.
   */
  async runCycle(input: RunCycleInput): Promise<ResearchCycle> {
    const cycleStartedAt = Date.now();
    stepLog(logger, "cycle", "start", {
      query: input.query,
      trigger: input.triggerType,
      daemonJob: input.daemonJob,
    });

    // 1. Resolve DAG plan
    const plan = await this.resolvePlan(input);
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
      // 3. Compute loop budget (complexity-aware, clamped by global caps)
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

      // 4. Run recursive research loop
      const { allFindings, totalCost, iterations } = await this.cycleLoop.run(
        plan,
        cycle.id,
        { maxIter, maxCost, budget },
        {
          query: input.query,
          minConfidence: input.minConfidence,
          lang: input.lang,
          mode: input.mode,
          hasUser: input.userId !== undefined && input.userId !== null,
        },
      );

      // 5. Persist findings to the knowledge graph (cortex resolved from
      // the INITIAL plan — matches pre-refactor behaviour).
      const storedCount = await this.persister.persist(allFindings, {
        cycleId: cycle.id,
        iteration: iterations,
        plan,
        entityOverride: input.entityOverride,
      });

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
          iterations,
          cost: totalCost.toFixed(4),
        },
        "Research cycle completed",
      );

      stepLog(logger, "cycle", "done", {
        cycleId: cycle.id.toString(),
        durationMs: Date.now() - cycleStartedAt,
        costUsd: totalCost,
        findings: storedCount,
        iterations,
      });

      // Refresh cycle with updated counts
      return (await this.cycleRepo.findById(cycle.id))!;
    } catch (err) {
      await this.cycleRepo.updateStatus(cycle.id, ResearchCycleStatus.Failed, {
        error: err instanceof Error ? err.message : String(err),
      });
      logger.error({ cycleId: cycle.id, err }, "Research cycle failed");
      stepLog(logger, "cycle", "error", {
        cycleId: cycle.id.toString(),
        durationMs: Date.now() - cycleStartedAt,
        err: err instanceof Error ? err.message : String(err),
      });
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

  /**
   * Select the DAG plan for a cycle:
   * - Caller-supplied DAG wins (no planner LLM call).
   * - Daemon jobs use pre-baked plans.
   * - Otherwise the planner LLM decomposes the query.
   */
  private async resolvePlan(input: RunCycleInput): Promise<DAGPlan> {
    if (input.dag) return input.dag;
    if (input.daemonJob) {
      return (
        this.planner.getDaemonDag(input.daemonJob) ?? {
          intent: input.query,
          complexity: "moderate" as const,
          nodes: [],
        }
      );
    }
    return this.planner.plan(input.query, {
      hasUser: input.userId !== undefined && input.userId !== null,
    });
  }
}

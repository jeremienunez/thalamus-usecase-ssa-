/**
 * Thalamus Service — Thin orchestrator for autonomous research.
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
import { THALAMUS_CONFIG } from "../cortices/config";
import {
  getReflexionConfig,
  getPlannerConfig,
  getBudgetsConfig,
} from "../config/runtime-config";
import {
  ResearchCycleTrigger,
  ResearchCycleStatus,
} from "@interview/shared/enum";
import type { ResearchGraphServicePort } from "./research-graph.types";
import type {
  ResearchCycle,
  ResearchCycleRunResult,
  NewResearchCycle,
} from "../types/research.types";
import type { ThalamusPlanner, DAGPlan } from "./thalamus-planner.service";
import type { CycleLoopRunner } from "./cycle-loop.service";
import type { FindingPersister } from "./finding-persister.service";
import { throwIfAborted } from "../transports/abort";

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
  signal?: AbortSignal;
}

export class ThalamusService {
  constructor(
    private planner: ThalamusPlanner,
    private cycleLoop: CycleLoopRunner,
    private persister: FindingPersister,
    private cycleRepo: CyclesPort,
    private graphService: ResearchGraphServicePort,
  ) {}

  /**
   * Run a full research cycle: plan → loop (execute + reflect) → store.
   * Returns the cycle record with findings count.
   */
  async runCycle(input: RunCycleInput): Promise<ResearchCycleRunResult> {
    throwIfAborted(input.signal);
    const cycleStartedAt = Date.now();
    stepLog(logger, "cycle", "start", {
      query: input.query,
      trigger: input.triggerType,
      daemonJob: input.daemonJob,
    });

    // 1. Resolve DAG plan
    const plan = await this.resolvePlan(input);
    throwIfAborted(input.signal);
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
      // 3. Compute loop budget (complexity-aware, clamped by global caps
      //    AND by runtime-tunable thalamus.reflexion.maxIterations — the
      //    operator knob wins when lower than the complexity default).
      const [reflexionCfg, plannerCfg, budgetsCfg] = await Promise.all([
        getReflexionConfig(),
        getPlannerConfig(),
        getBudgetsConfig(),
      ]);
      const budget =
        budgetsCfg[plan.complexity as keyof typeof budgetsCfg] ??
        budgetsCfg.moderate;
      const maxIter = Math.min(
        budget.maxIterations,
        THALAMUS_CONFIG.loop.maxIterationsPerChain,
        reflexionCfg.maxIterations,
      );
      // When the operator sets plannerCfg.maxCostUsd > 0, that explicit
      // override wins over BOTH the complexity-indexed budget AND the
      // hardcoded $0.10 safety cap — reasoning-heavy runs (xhigh /
      // thinking / MiniMax) routinely need $0.50–$2 per cycle.
      const maxCost =
        plannerCfg.maxCostUsd > 0
          ? plannerCfg.maxCostUsd
          : Math.min(budget.maxCost, THALAMUS_CONFIG.loop.maxCostPerChain);

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
      const { allFindings, totalCost, iterations, verification } =
        await this.cycleLoop.run(
          plan,
          cycle.id,
          { maxIter, maxCost, budget },
          {
            query: input.query,
            minConfidence: input.minConfidence,
            lang: input.lang,
            mode: input.mode,
            userId: input.userId,
            hasUser: input.userId !== undefined && input.userId !== null,
            signal: input.signal,
          },
        );
      throwIfAborted(input.signal);

      // 5. Persist findings to the knowledge graph (cortex resolved from
      // the INITIAL plan — matches pre-refactor behaviour).
      const persistence = await this.persister.persist(allFindings, {
        cycleId: cycle.id,
        iteration: iterations,
        plan,
        entityOverride: input.entityOverride,
      });

      if (persistence.failedCount > 0) {
        logger.warn(
          {
            cycleId: cycle.id,
            storedFindings: persistence.storedCount,
            failedFindings: persistence.failedCount,
            failures: persistence.failures,
          },
          "Research cycle completed with persistence warnings",
        );
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
          findings: persistence.storedCount,
          failedFindings: persistence.failedCount,
          iterations,
          cost: totalCost.toFixed(4),
        },
        "Research cycle completed",
      );

      stepLog(logger, "cycle", "done", {
        cycleId: cycle.id.toString(),
        durationMs: Date.now() - cycleStartedAt,
        costUsd: totalCost,
        findings: persistence.storedCount,
        failedFindings: persistence.failedCount,
        iterations,
      });

      // Refresh cycle with updated counts
      return {
        ...(await this.cycleRepo.findById(cycle.id))!,
        verification,
        persistence,
      };
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
  async runDaemonJob(jobName: string): Promise<ResearchCycleRunResult> {
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
   * - Manual cortex lists build a flat DAG without planner LLM calls.
   * - Otherwise the planner LLM decomposes the query.
   */
  private async resolvePlan(input: RunCycleInput): Promise<DAGPlan> {
    const planOpts = {
      hasUser: input.userId !== undefined && input.userId !== null,
    };
    if (input.dag) {
      return this.planner.finalizePlan(input.dag, planOpts, input.query);
    }
    if (input.daemonJob) {
      return (
        (await this.planner.getDaemonDag(input.daemonJob)) ?? {
          intent: input.query,
          complexity: "moderate" as const,
          nodes: [],
        }
      );
    }
    if (input.cortices) {
      return this.planner.finalizePlan(
        this.planner.buildManualDag(input.query, input.cortices),
        planOpts,
        input.query,
      );
    }
    return this.planner.plan(input.query, {
      hasUser: input.userId !== undefined && input.userId !== null,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }
}

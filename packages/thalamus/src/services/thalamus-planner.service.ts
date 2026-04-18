/**
 * Thalamus Planner — Generates DAG execution plans from research queries.
 *
 * Domain: SSA (Space Situational Awareness). Reads cortex skill headers and
 * produces a DAG of cortex activations with dependencies.
 *
 * For daemon triggers, uses predefined DAGs (no LLM call needed).
 * For user queries, calls the LLM to decompose into an optimal cortex plan.
 */

import { z } from "zod";
import { createLlmTransport } from "../transports/llm-chat";
import { createLogger, stepLog } from "@interview/shared/observability";
import { extractJson } from "../utils/llm-json-parser";
import type { CortexRegistry } from "../cortices/registry";
import type { DAGNode, DAGPlan, QueryComplexity } from "../cortices/types";
import { buildPlannerSystemPrompt } from "../prompts";
import { DAEMON_DAGS as DEFAULT_DAEMON_DAGS } from "../config/daemon-dags.config";

const logger = createLogger("thalamus-planner");

export type { DAGNode, DAGPlan, QueryComplexity } from "../cortices/types";

const dagPlanSchema = z.object({
  intent: z.string(),
  nodes: z.array(
    z.object({
      cortex: z.string(),
      params: z.record(z.string(), z.unknown()).default({}),
      dependsOn: z.array(z.string()).default([]),
    }),
  ),
  complexity: z.enum(["simple", "moderate", "deep"]).default("moderate"),
});

// ============================================================================
// Planner
// ============================================================================

export interface PlanOptions {
  /** False when running autonomously — user-scoped cortices are stripped. */
  hasUser?: boolean;
}

export class ThalamusPlanner {
  private readonly daemonDags: Record<string, DAGPlan>;
  private readonly userScopedCortices: Set<string>;

  constructor(
    private registry: CortexRegistry,
    daemonDags: Record<string, DAGPlan> = DEFAULT_DAEMON_DAGS,
    userScopedCortices: Set<string> = new Set(),
  ) {
    this.daemonDags = daemonDags;
    this.userScopedCortices = userScopedCortices;
  }

  /**
   * Plan a research cycle from a user query.
   * Reads skill headers, calls LLM to produce optimal DAG.
   */
  async plan(query: string, opts: PlanOptions = {}): Promise<DAGPlan> {
    stepLog(logger, "planner", "start", { query });
    const plannerStartedAt = Date.now();
    const headers = this.registry.getHeadersForPlanner();
    const cortexNames = this.registry.names();

    const systemPrompt = buildPlannerSystemPrompt({ headers, cortexNames });
    const transport = createLlmTransport(systemPrompt);

    try {
      const response = await transport.call(
        `Research query: "${query}"\n\nProduce the optimal DAG plan.`,
      );
      const plan = safeParseDAG(response.content, dagPlanSchema);

      // Validate cortex names
      plan.nodes = plan.nodes.filter((n) => this.registry.has(n.cortex));

      // Drop user-scoped cortices when running without a user context —
      // they'd short-circuit to empty output and burn a DAG slot.
      plan.nodes = this.stripUserScoped(plan.nodes, opts, query);

      if (plan.nodes.length === 0) {
        logger.warn({ query }, "Planner produced empty DAG, using fallback");
        const fallback = this.fallbackPlan(query);
        stepLog(logger, "planner", "done", {
          intent: fallback.intent,
          cortices: fallback.nodes.map((n) => n.cortex),
          complexity: fallback.complexity,
          fallback: true,
          durationMs: Date.now() - plannerStartedAt,
        });
        return fallback;
      }

      logger.info(
        {
          intent: plan.intent,
          cortices: plan.nodes.map((n) => n.cortex),
        },
        "DAG plan generated",
      );
      stepLog(logger, "planner", "done", {
        intent: plan.intent,
        cortices: plan.nodes.map((n) => n.cortex),
        complexity: plan.complexity,
        durationMs: Date.now() - plannerStartedAt,
      });
      return plan;
    } catch (err) {
      logger.error({ query, err }, "Planner LLM failed, using fallback");
      stepLog(logger, "planner", "error", {
        query,
        err: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - plannerStartedAt,
      });
      return this.fallbackPlan(query);
    }
  }

  /**
   * Get a predefined DAG for daemon triggers.
   * Daemon runs never have a user, so user-scoped cortices are stripped.
   */
  getDaemonDag(jobName: string): DAGPlan | null {
    const base = this.daemonDags[jobName];
    if (!base) return null;
    const nodes = this.stripUserScoped(base.nodes, { hasUser: false }, jobName);
    return { ...base, nodes };
  }

  /**
   * Remove user-scoped cortices when no user is in scope, and also prune any
   * `dependsOn` references pointing to stripped nodes (keeps the DAG executable).
   */
  private stripUserScoped(
    nodes: DAGNode[],
    opts: PlanOptions,
    context: string,
  ): DAGNode[] {
    if (opts.hasUser !== false || this.userScopedCortices.size === 0) {
      return nodes;
    }
    const dropped = new Set<string>();
    const kept = nodes.filter((n) => {
      if (this.userScopedCortices.has(n.cortex)) {
        dropped.add(n.cortex);
        return false;
      }
      return true;
    });
    if (dropped.size === 0) return nodes;
    logger.warn(
      { context, dropped: [...dropped] },
      "Stripped user-scoped cortices from DAG (no user in scope)",
    );
    return kept.map((n) => ({
      ...n,
      dependsOn: n.dependsOn.filter((d) => !dropped.has(d)),
    }));
  }

  /**
   * Fallback: broad 4-cortex sweep when planner LLM fails.
   * Covers fleet + traffic + regime + synthesis.
   */
  private fallbackPlan(query: string): DAGPlan {
    return {
      intent: query,
      complexity: "moderate",
      nodes: [
        { cortex: "fleet_analyst", params: { limit: 100 }, dependsOn: [] },
        { cortex: "conjunction_analysis", params: { window: "30d" }, dependsOn: [] },
        {
          cortex: "regime_profiler",
          params: { focus: "underexplored" },
          dependsOn: [],
        },
        {
          cortex: "strategist",
          params: {},
          dependsOn: [
            "fleet_analyst",
            "conjunction_analysis",
            "regime_profiler",
          ],
        },
      ],
    };
  }
}

/**
 * Robust DAG parser — delegates to shared LLM JSON parser + Zod validation.
 */
function safeParseDAG(content: string, schema: z.ZodTypeAny): DAGPlan {
  const raw = extractJson(content);
  if (!raw) throw new Error("No JSON found in LLM response");
  return schema.parse(raw) as DAGPlan;
}

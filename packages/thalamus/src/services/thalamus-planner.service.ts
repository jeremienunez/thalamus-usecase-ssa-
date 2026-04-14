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

const logger = createLogger("thalamus-planner");

// ============================================================================
// DAG Types
// ============================================================================

export interface DAGNode {
  cortex: string;
  params: Record<string, unknown>;
  dependsOn: string[];
}

export type QueryComplexity = "simple" | "moderate" | "deep";

export interface DAGPlan {
  intent: string;
  nodes: DAGNode[];
  complexity: QueryComplexity;
}

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
// Predefined DAGs for daemon triggers (no LLM needed)
//
// Cortex keys track the SSA `ResearchCortex` enum values (snake_case).
// ============================================================================

export const DAEMON_DAGS: Record<string, DAGPlan> = {
  "daily-scan": {
    intent: "Daily scan for conjunction anomalies and tasking opportunities",
    complexity: "moderate",
    nodes: [
      { cortex: "fleet_analyst", params: { limit: 200 }, dependsOn: [] },
      { cortex: "conjunction_analysis", params: {}, dependsOn: [] },
      {
        cortex: "strategist",
        params: {},
        dependsOn: ["fleet_analyst", "conjunction_analysis"],
      },
    ],
  },
  "weekly-trends": {
    intent:
      "Weekly traffic analysis, orbital-regime insights, and advisory monitoring",
    complexity: "moderate",
    nodes: [
      { cortex: "fleet_analyst", params: { window: "7d" }, dependsOn: [] },
      {
        cortex: "regime_profiler",
        params: { focus: "underexplored" },
        dependsOn: [],
      },
      {
        cortex: "advisory_radar",
        params: { category: "ADVISORIES", days: 14 },
        dependsOn: [],
      },
      {
        cortex: "strategist",
        params: {},
        dependsOn: ["fleet_analyst", "regime_profiler", "advisory_radar"],
      },
    ],
  },
  "debris-forecast": {
    intent: "Monthly debris / fragmentation forecast",
    complexity: "simple",
    nodes: [
      {
        cortex: "debris_forecaster",
        params: { year: new Date().getFullYear() },
        dependsOn: [],
      },
    ],
  },
  "monthly-audit": {
    intent: "Monthly catalog data quality and classification audit",
    complexity: "deep",
    nodes: [
      { cortex: "data_auditor", params: { regime: "ALL" }, dependsOn: [] },
      { cortex: "classification_auditor", params: {}, dependsOn: [] },
    ],
  },
  "weekly-fleet": {
    intent: "Weekly fleet analysis and orbital-slot optimization",
    complexity: "moderate",
    nodes: [
      { cortex: "fleet_analyst", params: {}, dependsOn: [] },
      { cortex: "fleet_analyst", params: { mode: "slot_optimization" }, dependsOn: [] },
      {
        cortex: "strategist",
        params: {},
        dependsOn: ["fleet_analyst"],
      },
    ],
  },
  "content-generation": {
    intent: "Generate editorial briefing from accumulated research findings",
    complexity: "moderate",
    nodes: [
      { cortex: "briefing_producer", params: {}, dependsOn: [] },
      {
        cortex: "strategist",
        params: { pageType: "briefing" },
        dependsOn: [],
      },
      {
        cortex: "briefing_producer",
        params: { mode: "generate" },
        dependsOn: ["strategist"],
      },
    ],
  },
  "content-copilot": {
    intent: "Assist with briefing section rewriting using KG data",
    complexity: "simple",
    nodes: [
      {
        cortex: "briefing_producer",
        params: { mode: "copilot" },
        dependsOn: [],
      },
    ],
  },
  "content-audit": {
    intent: "Audit existing briefing content against KG",
    complexity: "simple",
    nodes: [
      {
        cortex: "strategist",
        params: { pageType: "briefing" },
        dependsOn: [],
      },
      {
        cortex: "briefing_producer",
        params: { mode: "audit" },
        dependsOn: ["strategist"],
      },
    ],
  },
};

// ============================================================================
// Planner
// ============================================================================

export class ThalamusPlanner {
  constructor(private registry: CortexRegistry) {}

  /**
   * Plan a research cycle from a user query.
   * Reads skill headers, calls LLM to produce optimal DAG.
   */
  async plan(query: string): Promise<DAGPlan> {
    stepLog(logger, "planner", "start", { query });
    const plannerStartedAt = Date.now();
    const headers = this.registry.getHeadersForPlanner();
    const cortexNames = this.registry.names();

    const systemPrompt = `You are Thalamus, an SSA (Space Situational Awareness) research planner. You decompose research questions into a DAG of cortex activations.

Available cortices:
${headers}

Rules:
- Each node has: cortex (name), params (key-value), dependsOn (list of cortex names that must complete first)
- Independent cortices should have empty dependsOn (they run in parallel)
- If a cortex needs results from another, add it to dependsOn
- Use 2-5 cortices per query. Don't activate every cortex unless the query truly requires it.
- Fleet-scoped cortices (fleet_analyst) require an operator / fleet identifier in params.
- strategist should always be last with dependsOn set to all other activated cortices.
- Valid cortex names: ${cortexNames.join(", ")}
- Classify query complexity:
  - "simple": single satellite / regime question, 1-2 cortices (e.g. "next GEO conjunction for Intelsat 901")
  - "moderate": multi-factor analysis, 2-3 cortices (e.g. "debris risk for Starlink shell 1")
  - "deep": cross-regime, multi-cortex investigation, 4+ cortices (e.g. "full LEO congestion picture next 30 days")

Respond with ONLY a JSON object: { "intent": "...", "complexity": "simple|moderate|deep", "nodes": [...] }`;
    const transport = createLlmTransport(systemPrompt);

    try {
      const response = await transport.call(
        `Research query: "${query}"\n\nProduce the optimal DAG plan.`,
      );
      const plan = safeParseDAG(response.content, dagPlanSchema);

      // Validate cortex names
      plan.nodes = plan.nodes.filter((n) => this.registry.has(n.cortex));

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
   */
  getDaemonDag(jobName: string): DAGPlan | null {
    return DAEMON_DAGS[jobName] ?? null;
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

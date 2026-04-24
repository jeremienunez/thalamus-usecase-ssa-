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
import { extractJson } from "@interview/shared/utils";
import type { CortexRegistry } from "../cortices/registry";
import type { DAGNode, DAGPlan, QueryComplexity } from "../cortices/types";
import { buildGenericPlannerSystemPrompt } from "../prompts";
import { getPlannerConfig, getCortexConfig } from "../config/runtime-config";
import { isAbortError } from "../transports/abort";

const logger = createLogger("thalamus-planner");

export type { DAGNode, DAGPlan, QueryComplexity } from "../cortices/types";

/**
 * PlannerConfig — app-owned seams consumed by ThalamusPlanner. Every field
 * optional; defaults preserve pre-agnosticity behavior (SSA planner prompt +
 * hardcoded SSA 4-cortex fallback). Phase 5 of the agnosticity cleanup
 * drops those legacy defaults once SSA domain-config injects both.
 */
export interface PlannerConfig {
  /** Daemon-trigger DAGs. Empty object by default; domains inject their
   *  own map (e.g. SSA_DAEMON_DAGS from apps/console-api/src/agent/ssa/daemon-dags.ts). */
  daemonDags?: Record<string, DAGPlan>;
  /** Cortices requiring a userId in params (fleet-scoped work). */
  userScopedCortices?: Set<string>;
  /** App-owned system-prompt builder. Defaults to the generic prompt. */
  plannerPrompt?: (input: {
    headers: string;
    cortexNames: readonly string[];
  }) => string;
  /** App-owned fallback DAG for empty/failed plans. */
  fallbackPlan?: (query: string) => DAGPlan;
  /** Flat list of cortices used to synthesize a fallback DAG when no
   *  `fallbackPlan` is provided. */
  fallbackCortices?: string[];
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
// Planner
// ============================================================================

export interface PlanOptions {
  /** False when running autonomously — user-scoped cortices are stripped. */
  hasUser?: boolean;
  signal?: AbortSignal;
}

export class ThalamusPlanner {
  private readonly daemonDags: Record<string, DAGPlan>;
  private readonly userScopedCortices: Set<string>;
  private readonly plannerPromptFn: (input: {
    headers: string;
    cortexNames: readonly string[];
  }) => string;
  private readonly injectedFallbackPlan?: (query: string) => DAGPlan;
  private readonly fallbackCortices: string[];

  constructor(
    private registry: CortexRegistry,
    config: PlannerConfig = {},
  ) {
    this.daemonDags = config.daemonDags ?? {};
    this.userScopedCortices = config.userScopedCortices ?? new Set();
    this.plannerPromptFn =
      config.plannerPrompt ?? buildGenericPlannerSystemPrompt;
    this.injectedFallbackPlan = config.fallbackPlan;
    this.fallbackCortices = config.fallbackCortices ?? [];
  }

  /**
   * Build the planner system prompt. Uses the injected builder when
   * provided, otherwise the legacy SSA-flavored default.
   */
  buildSystemPrompt(input: {
    headers: string;
    cortexNames: readonly string[];
  }): string {
    return this.plannerPromptFn(input);
  }

  /**
   * Select the fallback DAG. Priority: injected `fallbackPlan` >
   * flat `fallbackCortices` > legacy SSA default. Exposed for unit
   * testing the seam selection; also called by `plan()` on empty/failed
   * LLM output.
   */
  resolveFallbackPlan(query: string): DAGPlan {
    if (this.injectedFallbackPlan) return this.injectedFallbackPlan(query);
    return {
      intent: query,
      complexity: "moderate",
      nodes: this.fallbackCortices.map((cortex) => ({
        cortex,
        params: {},
        dependsOn: [] as string[],
      })),
    };
  }

  /**
   * Build a flat manually-selected DAG. This is the programmatic bypass for
   * callers that already know which cortices should run and do not want an LLM
   * planning call.
   */
  buildManualDag(query: string, cortices: string[]): DAGPlan {
    const nodes: DAGNode[] = [];
    const seen = new Set<string>();
    const unknown: string[] = [];

    for (const cortex of cortices.map((name) => name.trim()).filter(Boolean)) {
      if (seen.has(cortex)) continue;
      seen.add(cortex);
      if (!this.registry.has(cortex)) {
        unknown.push(cortex);
        continue;
      }
      nodes.push({ cortex, params: {}, dependsOn: [] });
    }

    if (unknown.length > 0) {
      throw new Error(`Unknown manual cortex name(s): ${unknown.join(", ")}`);
    }

    return {
      intent: query,
      complexity: "moderate",
      nodes,
    };
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
    const [plannerCfg, cortexCfg] = await Promise.all([
      getPlannerConfig(),
      getCortexConfig(),
    ]);

    const systemPrompt = this.buildSystemPrompt({ headers, cortexNames });
    const transport = createLlmTransport(systemPrompt, {
      preferredProvider:
        plannerCfg.provider === "local" ||
        plannerCfg.provider === "kimi" ||
        plannerCfg.provider === "openai" ||
        plannerCfg.provider === "minimax"
          ? plannerCfg.provider
          : undefined,
      overrides: {
        model: plannerCfg.model,
        maxOutputTokens: plannerCfg.maxOutputTokens,
        temperature: plannerCfg.temperature,
        reasoningEffort: plannerCfg.reasoningEffort,
        verbosity: plannerCfg.verbosity,
        thinking: plannerCfg.thinking,
        reasoningFormat: plannerCfg.reasoningFormat,
        reasoningSplit: plannerCfg.reasoningSplit,
      },
    });

    try {
      const prompt = `Research query: "${query}"\n\nProduce the optimal DAG plan.`;
      const response = opts.signal
        ? await transport.call(prompt, { signal: opts.signal })
        : await transport.call(prompt);
      const plan = safeParseDAG(response.content, dagPlanSchema);

      // Validate cortex names
      plan.nodes = plan.nodes.filter((n) => this.registry.has(n.cortex));

      // Apply runtime-config post-filters (OCP: the prompt rubric is a
      // soft hint; the filters are the hard contract).
      plan.nodes = this.applyRuntimeFilters(plan.nodes, plannerCfg, cortexCfg);

      // Drop user-scoped cortices when running without a user context —
      // they'd short-circuit to empty output and burn a DAG slot.
      plan.nodes = this.stripUserScoped(plan.nodes, opts, query);

      if (plan.nodes.length === 0) {
        logger.warn({ query }, "Planner produced empty DAG, using fallback");
        const fallback = this.resolveFallbackPlan(query);
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
      if (isAbortError(err)) throw err;
      logger.error({ query, err }, "Planner LLM failed, using fallback");
      stepLog(logger, "planner", "error", {
        query,
        err: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - plannerStartedAt,
      });
      return this.resolveFallbackPlan(query);
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
   * Apply runtime-config knobs from `thalamus.planner` and `thalamus.cortex`:
   *
   *   1. Strip `disabledCortices` + cortex-level `enabled: false` overrides
   *   2. Inject `forcedCortices` not already in the plan (empty dependsOn)
   *   3. Ensure `strategist` exists when `mandatoryStrategist` is true,
   *      with dependsOn set to all other nodes
   *   4. Clamp to `maxCortices` while preserving strategist if present
   *
   * Order matters: disable first to free budget, force, reserve strategist
   * before clamping when mandatory, then clamp while preserving strategist.
   */
  applyRuntimeFilters(
    nodes: DAGNode[],
    plannerCfg: {
      maxCortices: number;
      mandatoryStrategist: boolean;
      forcedCortices: string[];
      disabledCortices: string[];
    },
    cortexCfg: {
      overrides: Record<string, { enabled?: boolean }>;
    },
  ): DAGNode[] {
    let kept = nodes;

    // 1. disable filters
    const disabled = new Set<string>(plannerCfg.disabledCortices);
    for (const [name, ovr] of Object.entries(cortexCfg.overrides)) {
      if (ovr.enabled === false) disabled.add(name);
    }
    if (disabled.size > 0) {
      kept = kept.filter((n) => !disabled.has(n.cortex));
    }

    // 2. force-inject (skip any that are disabled or already present)
    const present = new Set(kept.map((n) => n.cortex));
    for (const name of plannerCfg.forcedCortices) {
      if (!this.registry.has(name)) continue;
      if (disabled.has(name)) continue;
      if (present.has(name)) continue;
      kept.push({ cortex: name, params: {}, dependsOn: [] });
      present.add(name);
    }

    // 3. mandatory strategist — reserve its slot before clamping
    const injectMandatoryStrategist =
      plannerCfg.mandatoryStrategist &&
      !disabled.has("strategist") &&
      this.registry.has("strategist") &&
      !kept.some((n) => n.cortex === "strategist");
    if (injectMandatoryStrategist) {
      kept.push({ cortex: "strategist", params: {}, dependsOn: [] });
    }

    // 4. clamp to maxCortices (strategist, if present, is held out + re-appended last)
    if (kept.length > plannerCfg.maxCortices) {
      const strategist = kept.find((n) => n.cortex === "strategist");
      const nonStrat = kept.filter((n) => n.cortex !== "strategist");
      const budget = strategist
        ? Math.max(0, plannerCfg.maxCortices - 1)
        : plannerCfg.maxCortices;
      kept = nonStrat.slice(0, budget);
      if (strategist) kept.push(strategist);
    }

    if (injectMandatoryStrategist) {
      const others = kept
        .filter((n) => n.cortex !== "strategist")
        .map((n) => n.cortex);
      kept = kept.map((n) =>
        n.cortex === "strategist" ? { ...n, dependsOn: others } : n,
      );
    }

    // Prune any dependsOn pointing at dropped nodes.
    const finalNames = new Set(kept.map((n) => n.cortex));
    return kept.map((n) => ({
      ...n,
      dependsOn: n.dependsOn.filter((d) => finalNames.has(d)),
    }));
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
}

/**
 * Robust DAG parser — delegates to shared LLM JSON parser + Zod validation.
 */
function safeParseDAG(content: string, schema: z.ZodTypeAny): DAGPlan {
  const raw = extractJson(content);
  if (!raw) throw new Error("No JSON found in LLM response");
  return schema.parse(raw) as DAGPlan;
}

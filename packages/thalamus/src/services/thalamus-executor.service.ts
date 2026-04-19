/**
 * Thalamus DAG Executor — Runs cortex DAG with parallel + sequential execution
 *
 * Independent cortices (empty dependsOn) run in parallel via Promise.all.
 * Dependent cortices chain sequentially, receiving upstream findings as context.
 */

import { createLogger, stepLog } from "@interview/shared/observability";
import type { CortexExecutor } from "../cortices/executor";
import type { CortexOutput, CortexInput } from "../cortices/types";
import type { DAGPlan, DAGNode } from "./thalamus-planner.service";
import {
  getPlannerConfig,
  getCortexConfig,
} from "../config/runtime-config";

const logger = createLogger("thalamus-executor");

// Cortices with web enrichment + LLM synthesis need more time
const CORTEX_TIMEOUT_OVERRIDES: Record<string, number> = {
  payload_profiler: 180_000, // 3 min — crawls SpaceTrack + ESA DISCOS + synthesis
};

/**
 * Adaptive per-cortex timeout. Reasoning-heavy + thinking + local runs
 * take much longer than the 90s default — e.g. gpt-5.4-nano xhigh routinely
 * hits 2–3 min for a single cortex. Multipliers:
 *   xhigh ×6, high ×3, medium ×1.5; MiniMax ×3; thinking ×3; local/ ×2.
 * Per-cortex override (`thalamus.cortex.overrides[x].callTimeoutMs`) and
 * static per-cortex overrides (payload_profiler) win over adaptive scaling.
 */
function computeTimeout(
  cortexName: string,
  baseMs: number,
  plannerCfg: {
    provider: string;
    model: string;
    reasoningEffort: string;
    thinking: boolean;
  },
  cortexOverride:
    | {
        callTimeoutMs?: number;
        provider?: string;
        model?: string;
        reasoningEffort?: string;
        thinking?: boolean;
      }
    | undefined,
): number {
  if (cortexOverride?.callTimeoutMs && cortexOverride.callTimeoutMs > 0) {
    return cortexOverride.callTimeoutMs;
  }
  const staticOverride = CORTEX_TIMEOUT_OVERRIDES[cortexName];
  if (staticOverride) return staticOverride;

  const effort = cortexOverride?.reasoningEffort ?? plannerCfg.reasoningEffort;
  const provider = cortexOverride?.provider ?? plannerCfg.provider;
  const model = cortexOverride?.model ?? plannerCfg.model;
  const thinking =
    typeof cortexOverride?.thinking === "boolean"
      ? cortexOverride.thinking
      : plannerCfg.thinking;

  let mult = 1;
  if (effort === "xhigh") mult = 6;
  else if (effort === "high") mult = 3;
  else if (effort === "medium") mult = 1.5;
  if (provider === "minimax") mult = Math.max(mult, 3);
  if (thinking === true) mult = Math.max(mult, 3);
  if (typeof model === "string" && model.startsWith("local/")) {
    mult = Math.max(mult, 2);
  }
  return Math.round(baseMs * mult);
}

export interface DAGExecutionResult {
  outputs: Map<string, CortexOutput>;
  totalDuration: number;
}

export class ThalamusDAGExecutor {
  constructor(private cortexExecutor: CortexExecutor) {}

  /**
   * Execute a DAG plan. Groups nodes by dependency level,
   * runs each level in parallel, chains results forward.
   */
  async execute(
    plan: DAGPlan,
    cycleId: bigint,
    lang?: "fr" | "en",
    mode?: "investment" | "audit",
    userId?: bigint,
  ): Promise<DAGExecutionResult> {
    const start = Date.now();
    const outputs = new Map<string, CortexOutput>();
    const levels = this.topologicalLevels(plan.nodes);

    logger.info(
      {
        intent: plan.intent,
        levels: levels.length,
        totalNodes: plan.nodes.length,
      },
      "DAG execution started",
    );

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      logger.info(
        { level: i, cortices: level.map((n) => n.cortex) },
        "Executing DAG level",
      );

      // Run all nodes in this level in parallel
      const results = await Promise.allSettled(
        level.map((node) =>
          this.executeNode(
            node,
            cycleId,
            plan.intent,
            outputs,
            lang,
            mode,
            userId,
          ),
        ),
      );

      // Collect results
      for (let j = 0; j < level.length; j++) {
        const result = results[j];
        const node = level[j];
        if (result.status === "fulfilled") {
          outputs.set(node.cortex, result.value);
        } else {
          logger.error(
            { cortex: node.cortex, error: result.reason },
            "Cortex execution failed",
          );
          outputs.set(node.cortex, {
            findings: [],
            metadata: { tokensUsed: 0, duration: 0, model: "error" },
          });
        }
      }
    }

    const totalDuration = Date.now() - start;
    const totalFindings = [...outputs.values()].reduce(
      (sum, o) => sum + o.findings.length,
      0,
    );

    logger.info(
      { totalDuration, totalFindings, cortices: [...outputs.keys()] },
      "DAG execution complete",
    );

    return { outputs, totalDuration };
  }

  /**
   * Execute a single DAG node with timeout and upstream context.
   */
  private async executeNode(
    node: DAGNode,
    cycleId: bigint,
    query: string,
    upstreamOutputs: Map<string, CortexOutput>,
    lang?: "fr" | "en",
    mode?: "investment" | "audit",
    userId?: bigint,
  ): Promise<CortexOutput> {
    // Build context from upstream dependencies
    const previousFindings = node.dependsOn.flatMap((dep) => {
      const upstream = upstreamOutputs.get(dep);
      if (!upstream) return [];
      return upstream.findings.map((f) => ({
        title: f.title,
        summary: f.summary,
        confidence: f.confidence,
      }));
    });

    const input: CortexInput = {
      query,
      params:
        userId !== undefined && node.params.userId === undefined
          ? { ...node.params, userId }
          : node.params,
      cycleId,
      lang,
      mode,
      context: previousFindings.length > 0 ? { previousFindings } : undefined,
    };

    // Execute with adaptive timeout: base is runtime-config
    // (thalamus.planner.cortexTimeoutMs), scaled by reasoning/provider/
    // thinking, and superseded by any per-cortex override.
    const [plannerCfg, cortexCfg] = await Promise.all([
      getPlannerConfig(),
      getCortexConfig(),
    ]);
    const cortexOverride = cortexCfg.overrides[node.cortex];
    const timeout = computeTimeout(
      node.cortex,
      plannerCfg.cortexTimeoutMs,
      {
        provider: plannerCfg.provider,
        model: plannerCfg.model,
        reasoningEffort: plannerCfg.reasoningEffort,
        thinking: plannerCfg.thinking,
      },
      cortexOverride,
    );
    const cortexStartedAt = Date.now();
    stepLog(logger, "cortex", "start", {
      cortex: node.cortex,
      cycleId: cycleId.toString(),
      dependsOn: node.dependsOn,
    });
    try {
      const result = await Promise.race([
        this.cortexExecutor.execute(node.cortex, input),
        new Promise<CortexOutput>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`Cortex ${node.cortex} timed out after ${timeout}ms`),
              ),
            timeout,
          ),
        ),
      ]);

      stepLog(logger, "cortex", "done", {
        cortex: node.cortex,
        cycleId: cycleId.toString(),
        findings: result.findings.length,
        durationMs: Date.now() - cortexStartedAt,
        tokensUsed: result.metadata.tokensUsed,
      });

      return result;
    } catch (err) {
      stepLog(logger, "cortex", "error", {
        cortex: node.cortex,
        cycleId: cycleId.toString(),
        durationMs: Date.now() - cortexStartedAt,
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Topological sort into parallel execution levels.
   * Level 0: nodes with no dependencies (run first, in parallel)
   * Level 1: nodes depending only on level 0 (run after level 0)
   * etc.
   */
  private topologicalLevels(nodes: DAGNode[]): DAGNode[][] {
    const levels: DAGNode[][] = [];
    const placed = new Set<string>();
    const remaining = [...nodes];

    while (remaining.length > 0) {
      const level: DAGNode[] = [];

      for (let i = remaining.length - 1; i >= 0; i--) {
        const node = remaining[i];
        const depsResolved = node.dependsOn.every((dep) => placed.has(dep));
        if (depsResolved) {
          level.push(node);
          remaining.splice(i, 1);
        }
      }

      if (level.length === 0) {
        // Circular dependency or unresolvable — dump remaining as last level
        logger.warn(
          { remaining: remaining.map((n) => n.cortex) },
          "Unresolvable DAG dependencies, forcing execution",
        );
        levels.push(remaining);
        break;
      }

      for (const node of level) {
        placed.add(node.cortex);
      }
      levels.push(level);
    }

    return levels;
  }
}

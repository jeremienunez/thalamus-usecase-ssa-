/**
 * Cortex Executor — thin dispatcher that delegates to an execution strategy.
 *
 * The actual pipelines live in `./strategies/`. The executor:
 *   1. Looks up the skill in the registry
 *   2. Picks the first strategy whose `canHandle(cortexName)` is `true`
 *   3. Delegates `execute()` to it
 *
 * Adding a new pipeline = new strategy + register at composition root.
 * No modification to this class (Open/Closed).
 */

import { createLogger } from "@interview/shared/observability";
import type { CortexRegistry } from "./registry";
import type { CortexInput, CortexOutput } from "./types";
import { createLlmTransportWithMode } from "../transports/factory";
import type { CortexExecutionStrategy } from "./strategies/types";
import { emptyOutput } from "./strategies/helpers";
import { getCortexConfig, getPlannerConfig } from "../config/runtime-config";

const logger = createLogger("cortex-executor");

export class CortexExecutor {
  constructor(
    private readonly registry: CortexRegistry,
    private readonly strategies: CortexExecutionStrategy[],
  ) {}

  /**
   * Execute a single cortex by name. Registry misses and strategy misses yield
   * an empty output. Strategy failures are allowed to reject so the DAG layer
   * can surface explicit per-cortex diagnostics.
   */
  async execute(cortexName: string, input: CortexInput): Promise<CortexOutput> {
    const [plannerCfg, cortexCfg] = await Promise.all([
      getPlannerConfig(),
      getCortexConfig(),
    ]);
    if (
      plannerCfg.disabledCortices.includes(cortexName) ||
      cortexCfg.overrides[cortexName]?.enabled === false
    ) {
      logger.info({ cortexName }, "Cortex disabled, skipping execution");
      return emptyOutput();
    }

    const skill = this.registry.get(cortexName);

    if (!skill) {
      logger.error({ cortexName }, "Cortex skill not found");
      return emptyOutput();
    }

    logger.info(
      { cortex: cortexName, query: input.query },
      "Cortex execution started",
    );

    const strategy = this.strategies.find((s) => s.canHandle(cortexName));
    if (!strategy) {
      logger.error(
        { cortexName, registered: this.strategies.length },
        "No execution strategy matches cortex",
      );
      return emptyOutput();
    }

    return strategy.execute(skill, input);
  }

  knownCortices(): string[] {
    return this.registry.names();
  }

  /**
   * Freeform skill invocation — bypasses SQL helpers, web enrichment, and
   * structured finding parsing. Loads the skill body as system prompt and
   * calls the LLM with the given user prompt verbatim.
   *
   * Used by the editorial copilot (audit + chat) where the skill already
   * knows how to respond and we do NOT want CortexFinding[] output.
   */
  async runSkillFreeform(
    cortexName: string,
    userPrompt: string,
    opts?: {
      enableWebSearch?: boolean;
      maxRetries?: number;
      signal?: AbortSignal;
    },
  ): Promise<{ content: string; provider: string }> {
    const skill = this.registry.get(cortexName);
    if (!skill) {
      logger.error({ cortexName }, "Cortex skill not found for freeform call");
      return { content: "", provider: "none" };
    }

    // Mode-aware: honours THALAMUS_MODE=fixtures|record|cloud so sim runs
    // (which call this for every turn) are replayable offline.
    const transport = createLlmTransportWithMode(skill.body, {
      enableWebSearch: opts?.enableWebSearch ?? false,
      maxRetries: opts?.maxRetries,
    });

    const response = opts?.signal
      ? await transport.call(userPrompt, { signal: opts.signal })
      : await transport.call(userPrompt);
    return { content: response.content, provider: response.provider };
  }
}

// Re-export so external callers (e.g. knowledge-graph writers, tests)
// keep their stable import surface after the strategy extraction.
export { normalizeFinding } from "./strategies/helpers";

/**
 * Thalamus Reflexion — Self-evaluation of research cycle results
 *
 * After DAG execution, evaluates evidence quality and can trigger replanning.
 * Iteration budget controlled by ThalamusService loop (complexity-based).
 */

import { z } from "zod";
import {
  createLlmTransport,
  LlmChatTransport,
} from "../transports/llm-chat";
import { createLogger, stepLog } from "@interview/shared/observability";
import type { CortexFinding } from "../cortices/types";
import { buildReflexionSystemPrompt } from "../prompts";
import { isAbortError } from "../transports/abort";

const logger = createLogger("thalamus-reflexion");

const reflexionSchema = z.object({
  replan: z.boolean(),
  notes: z.string(),
  gaps: z.array(z.string()).optional(),
  overallConfidence: z.number().min(0).max(1),
});

export type ReflexionResult = z.infer<typeof reflexionSchema>;

export class ThalamusReflexion {
  /**
   * Evaluate findings from a research cycle.
   * Returns whether to replan and what gaps were found.
   *
   * Takes both `rawFindings` (every finding the cortices emitted, regardless
   * of confidence) and `keptFindings` (those above the confidence gate).
   * When raw > 0 but kept == 0 the cortices produced signal but at low
   * confidence — that is a clear replan trigger: send the loop after
   * corroborating data rather than stopping.
   */
  async evaluate(
    intent: string,
    rawFindings: CortexFinding[],
    keptFindings: CortexFinding[],
    iteration: number,
    context?: {
      complexity?: string;
      remainingBudget?: number;
      maxIterations?: number;
      signal?: AbortSignal;
    },
  ): Promise<ReflexionResult> {
    stepLog(logger, "reflexion", "start", {
      iteration,
      raw: rawFindings.length,
      kept: keptFindings.length,
    });
    const reflexionStartedAt = Date.now();

    // Only truly empty rounds (cortices returned nothing at all) short-circuit.
    if (rawFindings.length === 0) {
      stepLog(logger, "reflexion", "done", {
        iteration,
        replan: false,
        reason: "empty-round",
        durationMs: Date.now() - reflexionStartedAt,
      });
      return {
        replan: false,
        notes: "No findings produced — nothing to evaluate",
        overallConfidence: 0,
      };
    }

    const lowConfidenceRound =
      keptFindings.length === 0 && rawFindings.length > 0;

    const transport = createLlmTransport(
      buildReflexionSystemPrompt({
        ...(context?.complexity !== undefined && {
          complexity: context.complexity,
        }),
        ...(context?.remainingBudget !== undefined && {
          remainingBudget: context.remainingBudget,
        }),
        ...(context?.maxIterations !== undefined && {
          maxIterations: context.maxIterations,
        }),
        iteration,
      }),
      { maxRetries: 1 },
    );

    const summarize = (f: CortexFinding, i: number) =>
      `${i + 1}. [${f.findingType}] ${f.title} (confidence: ${f.confidence}, evidence: ${f.evidence.length} items)`;

    const rawSummary = rawFindings.map(summarize).join("\n");
    const keptSummary =
      keptFindings.length > 0
        ? keptFindings.map(summarize).join("\n")
        : "(none — all raw findings below confidence gate)";

    const header = lowConfidenceRound
      ? `Research intent: "${intent}"\nIteration: ${iteration}\nLow-confidence round: ${rawFindings.length} raw, 0 kept.\n`
      : `Research intent: "${intent}"\nIteration: ${iteration}\n`;

    try {
      const prompt = `${header}\nRAW findings:\n${rawSummary}\n\nKEPT findings:\n${keptSummary}`;
      const response = context?.signal
        ? await transport.call(prompt, { signal: context.signal })
        : await transport.call(prompt);
      const result = LlmChatTransport.parseJson(
        response.content,
        reflexionSchema,
      );

      logger.info(
        {
          replan: result.replan,
          confidence: result.overallConfidence,
          gaps: result.gaps?.length ?? 0,
          iteration,
          raw: rawFindings.length,
          kept: keptFindings.length,
          lowConfidenceRound,
        },
        "Reflexion evaluation complete",
      );

      stepLog(logger, "reflexion", "done", {
        iteration,
        replan: result.replan,
        confidence: result.overallConfidence,
        gaps: result.gaps?.length ?? 0,
        lowConfidenceRound,
        durationMs: Date.now() - reflexionStartedAt,
      });

      return result;
    } catch (err) {
      if (isAbortError(err)) throw err;
      logger.error(
        { err, iteration },
        "Reflexion LLM failed, approving findings",
      );
      stepLog(logger, "reflexion", "error", {
        iteration,
        err: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - reflexionStartedAt,
      });
      return {
        replan: false,
        notes: "Reflexion failed — approving findings as-is",
        overallConfidence: avgConfidence(keptFindings),
      };
    }
  }
}

function avgConfidence(findings: CortexFinding[]): number {
  if (findings.length === 0) return 0;
  return findings.reduce((sum, f) => sum + f.confidence, 0) / findings.length;
}

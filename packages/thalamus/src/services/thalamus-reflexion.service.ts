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

    const budgetCtx = context
      ? `\nQuery complexity: ${context.complexity ?? "moderate"}. Remaining cost budget: $${(context.remainingBudget ?? 0).toFixed(3)}. Max iterations: ${context.maxIterations ?? "?"}, current: ${iteration}.`
      : "";

    const lowConfidenceRound =
      keptFindings.length === 0 && rawFindings.length > 0;

    const transport = createLlmTransport(
      `You are a research quality evaluator. Assess whether the findings adequately answer the research intent.${budgetCtx}

Findings come in two buckets:
- RAW: every finding the cortices emitted, regardless of confidence.
- KEPT: raw findings that cleared the confidence gate (threshold set by caller).

Evaluate:
1. Is the evidence in KEPT sufficient for each finding?
2. Are there contradictory signals across findings?
3. What critical data is missing?
4. Would additional cortex activations improve the answer?
5. Is replanning worth the remaining budget?

SPECIAL CASE — low-confidence round (RAW > 0 but KEPT == 0):
  Cortices produced signal but below the confidence gate. This is NOT a
  reason to stop. Populate gaps[] with cortices or data sources that
  could corroborate the low-confidence RAW findings, and set replan=true
  so the next iteration targets those gaps.

If gaps are significant AND budget allows, recommend replanning.
If findings in KEPT are solid OR budget is nearly exhausted, approve them.

Respond with ONLY JSON: { "replan": bool, "notes": "...", "gaps": ["..."], "overallConfidence": 0.0-1.0 }`,
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
      const response = await transport.call(
        `${header}\nRAW findings:\n${rawSummary}\n\nKEPT findings:\n${keptSummary}`,
      );
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

/**
 * ThalamusReflexion — system prompt.
 *
 * Agnostic: evaluates whether cortex findings satisfy a research intent.
 * No domain vocabulary — any caller producing CortexFinding[] can reuse it.
 */

export interface ReflexionPromptInput {
  complexity?: string;
  remainingBudget?: number;
  maxIterations?: number;
  iteration?: number;
}

export function buildReflexionSystemPrompt(
  input: ReflexionPromptInput = {},
): string {
  const budgetCtx =
    input.complexity !== undefined ||
    input.remainingBudget !== undefined ||
    input.maxIterations !== undefined
      ? `\nQuery complexity: ${input.complexity ?? "moderate"}. Remaining cost budget: $${(input.remainingBudget ?? 0).toFixed(3)}. Max iterations: ${input.maxIterations ?? "?"}, current: ${input.iteration ?? "?"}.`
      : "";

  return `You are a research quality evaluator. Assess whether the findings adequately answer the research intent.${budgetCtx}

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

Respond with ONLY JSON: { "replan": bool, "notes": "...", "gaps": ["..."], "overallConfidence": 0.0-1.0 }`;
}

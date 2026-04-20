/**
 * Domain-agnostic planner system prompt. Used by ThalamusPlanner when
 * DomainConfig.plannerPrompt is not provided. Describes DAG mechanics
 * and JSON output shape without domain vocabulary.
 */

export interface GenericPlannerPromptInput {
  /** Registry-derived cortex headers block (pre-formatted multi-line string). */
  headers: string;
  /** Valid cortex names whitelist used for validation. */
  cortexNames: readonly string[];
}

export function buildGenericPlannerSystemPrompt(
  input: GenericPlannerPromptInput,
): string {
  return `You are a research planner. You decompose research questions into a DAG of cortex activations.

Available cortices:
${input.headers}

Rules:
- Each node has: cortex (name), params (key-value), dependsOn (list of cortex names that must complete first).
- Independent cortices should have empty dependsOn (they run in parallel).
- If a cortex needs results from another, add it to dependsOn.
- Use 2-5 cortices per query. Don't activate every cortex unless the query truly requires it.
- Never activate the same cortex twice in one DAG.
- Valid cortex names: ${input.cortexNames.join(", ")}
- Params must come only from explicit query text or obvious header defaults. Never invent identifiers, dates, or thresholds.
- Classify query complexity: "simple" | "moderate" | "deep".

Respond with ONLY a JSON object: { "intent": "...", "complexity": "simple|moderate|deep", "nodes": [...] }`;
}

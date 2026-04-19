/**
 * OpenAIProvider — GPT-5 family via the Responses API.
 *
 * Honours runtime overrides (model / reasoning.effort / text.verbosity /
 * max_output_tokens / temperature) when the planner config supplies them.
 * Falls back to enrichment env config when a knob is unset.
 */

import { enrichmentFallbackConfig } from "../../config/enrichment";
import { stripThinkingChannels } from "./strip-thinking";
import type { LlmProvider, LlmProviderCallOpts } from "./types";

export class OpenAIProvider implements LlmProvider {
  readonly name = "openai" as const;

  isEnabled(): boolean {
    return Boolean(enrichmentFallbackConfig.openaiApiKey);
  }

  async call(
    systemPrompt: string,
    userPrompt: string,
    opts: LlmProviderCallOpts,
  ): Promise<string> {
    const model = opts.model ?? enrichmentFallbackConfig.model;
    // Responses API uses nested reasoning.effort; valid for gpt-5.4 family
    // is none|low|medium|high|xhigh. "minimal" was gpt-5-only.
    const effort = opts.reasoningEffort ?? "minimal";
    const verbosity = opts.verbosity;

    const body: Record<string, unknown> = {
      model,
      instructions: systemPrompt,
      input: userPrompt,
      reasoning: { effort },
      text: verbosity
        ? { format: { type: "text" }, verbosity }
        : { format: { type: "text" } },
      store: true,
    };
    if (opts.maxOutputTokens && opts.maxOutputTokens > 0) {
      body.max_output_tokens = opts.maxOutputTokens;
    }
    if (typeof opts.temperature === "number") {
      body.temperature = opts.temperature;
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${enrichmentFallbackConfig.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}: ${rawBody}`);
    }

    const data = JSON.parse(rawBody) as {
      output: Array<{
        type: string;
        content?: Array<{ type: string; text?: string }>;
      }>;
    };

    const text = data.output
      ?.filter((o) => o.type === "message")
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("");

    return stripThinkingChannels(text);
  }
}

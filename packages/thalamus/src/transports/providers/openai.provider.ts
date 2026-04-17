/**
 * OpenAIProvider — GPT-5 family via the Responses API (fallback).
 *
 * Uses `reasoning.effort: "minimal"` because Kimi does the deep thinking;
 * OpenAI's role here is a fast last-resort response.
 */

import { enrichmentFallbackConfig } from "../../config/enrichment";
import type { LlmProvider, LlmProviderCallOpts } from "./types";

export class OpenAIProvider implements LlmProvider {
  readonly name = "openai" as const;

  isEnabled(): boolean {
    return Boolean(enrichmentFallbackConfig.openaiApiKey);
  }

  async call(
    systemPrompt: string,
    userPrompt: string,
    _opts: LlmProviderCallOpts,
  ): Promise<string> {
    // GPT-5 series: use Responses API (not Chat Completions)
    // Reasoning effort "minimal" for fast fallback — Kimi does the deep thinking
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${enrichmentFallbackConfig.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: enrichmentFallbackConfig.model,
        instructions: systemPrompt,
        input: userPrompt,
        reasoning: { effort: "minimal" },
        text: { format: { type: "text" } },
        store: true,
      }),
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

    // Extract text from response output items
    const text = data.output
      ?.filter((o) => o.type === "message")
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("");

    return text;
  }
}

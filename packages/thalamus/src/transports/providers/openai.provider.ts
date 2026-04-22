/**
 * OpenAIProvider — GPT-5 family via the Responses API.
 *
 * Honours runtime overrides (model / reasoning.effort / text.verbosity /
 * max_output_tokens / temperature) when the planner config supplies them.
 * Falls back to enrichment env config when a knob is unset.
 */

import { createLogger } from "@interview/shared/observability";
import {
  getEnrichmentFallbackConfig,
  getEnrichmentFallbackConfigSnapshot,
} from "../../config/enrichment";
import { stripThinkingChannels } from "./strip-thinking";
import type { LlmProvider, LlmProviderCallOpts } from "./types";

const logger = createLogger("llm-provider-openai");

export class OpenAIProvider implements LlmProvider {
  readonly name = "openai" as const;
  private config = getEnrichmentFallbackConfigSnapshot();

  async refreshConfig(): Promise<void> {
    this.config = await getEnrichmentFallbackConfig();
  }

  isEnabled(): boolean {
    return Boolean(this.config.openaiApiKey);
  }

  async call(
    systemPrompt: string,
    userPrompt: string,
    opts: LlmProviderCallOpts,
  ): Promise<string> {
    await this.refreshConfig();
    const config = this.config;
    const model = opts.model ?? config.model;
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
    // Only set max_output_tokens when the caller explicitly provided a
    // positive value. Leaving it unset lets the OpenAI server use its
    // own default, which is what we want for benchmarking — the bench
    // pass needs to see where truncation naturally occurs before we
    // decide on a heuristic cap.
    if (opts.maxOutputTokens && opts.maxOutputTokens > 0) {
      body.max_output_tokens = opts.maxOutputTokens;
    }
    if (typeof opts.temperature === "number") {
      body.temperature = opts.temperature;
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}: ${rawBody}`);
    }

    const data = JSON.parse(rawBody) as {
      status?: string;
      incomplete_details?: { reason?: string };
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        output_tokens_details?: { reasoning_tokens?: number };
      };
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

    // Bench signal: log when the response came back incomplete so we
    // can correlate truncation with reasoning_effort + prompt size.
    // OpenAI sets status="incomplete" and incomplete_details.reason
    // (e.g. "max_output_tokens") when the cap hit before the model
    // finished emitting.
    if (data.status === "incomplete" || data.incomplete_details?.reason) {
      logger.warn(
        {
          reason: data.incomplete_details?.reason ?? data.status,
          model,
          effort,
          verbosity,
          maxOutputTokens: opts.maxOutputTokens ?? null,
          inputTokens: data.usage?.input_tokens,
          outputTokens: data.usage?.output_tokens,
          reasoningTokens: data.usage?.output_tokens_details?.reasoning_tokens,
          completionChars: text.length,
        },
        "OpenAI response incomplete — completion truncated",
      );
    }

    return stripThinkingChannels(text);
  }
}

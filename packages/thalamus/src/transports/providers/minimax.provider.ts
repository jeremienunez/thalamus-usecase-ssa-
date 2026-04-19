/**
 * MiniMaxProvider — M-series chat completions (OpenAI-compatible shape).
 *
 * Honours `opts.reasoningSplit` which maps to the MiniMax-specific
 * `reasoning_split` boolean: true = reasoning tokens returned in a
 * separate `reasoning_details` field, false (default) = inline `<think>`
 * blocks in the main content.
 *
 * Other knobs (thinking / reasoningEffort / verbosity) are documented as
 * unsupported on M2.7 (per Moonshot/MiniMax API refs) and silently ignored.
 */

import { createLogger } from "@interview/shared/observability";
import { isMinimaxEnabled, minimaxConfig } from "../../config/enrichment";
import { stripThinkingChannels } from "./strip-thinking";
import type { LlmProvider, LlmProviderCallOpts } from "./types";

const logger = createLogger("llm-provider-minimax");

export class MiniMaxProvider implements LlmProvider {
  readonly name = "minimax" as const;

  isEnabled(): boolean {
    return isMinimaxEnabled();
  }

  async call(
    systemPrompt: string,
    userPrompt: string,
    opts: LlmProviderCallOpts,
  ): Promise<string> {
    const model = opts.model ?? minimaxConfig.model;
    const maxTokens =
      opts.maxOutputTokens && opts.maxOutputTokens > 0
        ? opts.maxOutputTokens
        : minimaxConfig.maxTokens;
    const temperature =
      typeof opts.temperature === "number" ? opts.temperature : 1.0;

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: maxTokens,
      temperature,
    };
    if (typeof opts.reasoningSplit === "boolean") {
      body.reasoning_split = opts.reasoningSplit;
    }

    const response = await fetch(minimaxConfig.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${minimaxConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`MiniMax API error ${response.status}: ${errBody}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          reasoning_content?: string | null;
          reasoning_details?: unknown;
        };
      }>;
    };
    const msg = data.choices[0]?.message;
    if (!msg) return "";

    if (msg.reasoning_content || msg.reasoning_details) {
      logger.debug(
        {
          reasoningLen: (msg.reasoning_content ?? "").length,
          hasReasoningDetails: Boolean(msg.reasoning_details),
          split: opts.reasoningSplit === true,
        },
        "MiniMax reasoning channel observed",
      );
    }

    return stripThinkingChannels(msg.content ?? "");
  }
}

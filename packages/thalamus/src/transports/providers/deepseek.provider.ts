/**
 * DeepSeekProvider — V4 chat completions via DeepSeek's OpenAI-compatible API.
 *
 * Provider-specific shape lives here: `thinking`, `reasoning_effort`,
 * `max_tokens`, and `reasoning_content` parsing. The orchestrator only sees
 * the generic LlmProvider contract.
 */

import { createLogger } from "@interview/shared/observability";
import {
  getDeepSeekConfig,
  getDeepSeekConfigSnapshot,
} from "../../config/enrichment";
import { throwIfAborted } from "../abort";
import { stripThinkingChannels } from "./strip-thinking";
import { callDeepSeekChatCompletion } from "./deepseek.client";
import type { LlmProvider, LlmProviderCallOpts } from "./types";

const logger = createLogger("llm-provider-deepseek");

export class DeepSeekProvider implements LlmProvider {
  readonly name = "deepseek" as const;
  private config = getDeepSeekConfigSnapshot();

  async refreshConfig(): Promise<void> {
    this.config = await getDeepSeekConfig();
  }

  isEnabled(): boolean {
    return Boolean(this.config.apiKey);
  }

  async call(
    systemPrompt: string,
    userPrompt: string,
    opts: LlmProviderCallOpts,
  ): Promise<string> {
    throwIfAborted(opts.signal);
    await this.refreshConfig();
    throwIfAborted(opts.signal);

    const result = await callDeepSeekChatCompletion(this.config, {
      systemPrompt,
      userPrompt,
      model: opts.model,
      maxOutputTokens: opts.maxOutputTokens,
      thinking: opts.thinking,
      reasoningEffort: opts.reasoningEffort,
      signal: opts.signal,
    });

    if (result.reasoningContent) {
      logger.debug(
        {
          reasoningLen: result.reasoningContent.length,
          contentLen: result.content.length,
          reasoningTokens:
            result.usage?.completion_tokens_details?.reasoning_tokens,
          finishReason: result.finishReason,
        },
        "DeepSeek reasoning channel observed",
      );
    }

    return stripThinkingChannels(result.content);
  }
}

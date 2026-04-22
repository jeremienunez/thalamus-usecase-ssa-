/**
 * LocalProvider — OpenAI-compatible local endpoint (llama.cpp / Ollama / vLLM).
 *
 * Honours runtime overrides for model / max_tokens / temperature, plus
 * llama.cpp-specific knobs: `reasoning_format` (none|deepseek|deepseek-legacy)
 * and Gemma 4 thinking toggle via `chat_template_kwargs.enable_thinking`.
 */

import {
  getLocalLlmConfig,
  getLocalLlmConfigSnapshot,
} from "../../config/enrichment";
import { stripThinkingChannels } from "./strip-thinking";
import type { LlmProvider, LlmProviderCallOpts } from "./types";

export class LocalProvider implements LlmProvider {
  readonly name = "local" as const;
  private config = getLocalLlmConfigSnapshot();

  async refreshConfig(): Promise<void> {
    this.config = await getLocalLlmConfig();
  }

  isEnabled(): boolean {
    return Boolean(this.config.url);
  }

  async call(
    systemPrompt: string,
    userPrompt: string,
    opts: LlmProviderCallOpts,
  ): Promise<string> {
    await this.refreshConfig();
    const config = this.config;
    const url = config.url.endsWith("/v1/chat/completions")
      ? config.url
      : `${config.url.replace(/\/$/, "")}/v1/chat/completions`;

    const model = opts.model ?? config.model;
    const maxTokens =
      opts.maxOutputTokens && opts.maxOutputTokens > 0
        ? opts.maxOutputTokens
        : config.maxTokens;
    const temperature =
      typeof opts.temperature === "number"
        ? opts.temperature
        : config.temperature;

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    };

    if (opts.reasoningFormat) {
      body.reasoning_format = opts.reasoningFormat;
    }
    if (typeof opts.thinking === "boolean") {
      body.chat_template_kwargs = { enable_thinking: opts.thinking };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const respBody = await response.text();
      throw new Error(`Local LLM error ${response.status}: ${respBody}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string | null } }>;
    };
    const raw = data.choices[0]?.message?.content ?? "";
    return stripThinkingChannels(raw);
  }
}

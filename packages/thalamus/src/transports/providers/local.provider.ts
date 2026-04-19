/**
 * LocalProvider — OpenAI-compatible local endpoint (llama.cpp / Ollama / vLLM).
 *
 * Honours runtime overrides for model / max_tokens / temperature, plus
 * llama.cpp-specific knobs: `reasoning_format` (none|deepseek|deepseek-legacy)
 * and Gemma 4 thinking toggle via `chat_template_kwargs.enable_thinking`.
 */

import { isLocalLlmEnabled, localLlmConfig } from "../../config/enrichment";
import { stripThinkingChannels } from "./strip-thinking";
import type { LlmProvider, LlmProviderCallOpts } from "./types";

export class LocalProvider implements LlmProvider {
  readonly name = "local" as const;

  isEnabled(): boolean {
    return isLocalLlmEnabled();
  }

  async call(
    systemPrompt: string,
    userPrompt: string,
    opts: LlmProviderCallOpts,
  ): Promise<string> {
    const url = localLlmConfig.url.endsWith("/v1/chat/completions")
      ? localLlmConfig.url
      : `${localLlmConfig.url.replace(/\/$/, "")}/v1/chat/completions`;

    const model = opts.model ?? localLlmConfig.model;
    const maxTokens =
      opts.maxOutputTokens && opts.maxOutputTokens > 0
        ? opts.maxOutputTokens
        : localLlmConfig.maxTokens;
    const temperature =
      typeof opts.temperature === "number"
        ? opts.temperature
        : localLlmConfig.temperature;

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

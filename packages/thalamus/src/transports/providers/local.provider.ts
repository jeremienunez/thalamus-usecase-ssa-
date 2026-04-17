/**
 * LocalProvider — OpenAI-compatible local endpoint (llama.cpp / Ollama / vLLM).
 *
 * Extracted from the old `LlmChatTransport.callLocal`. Self-contained: owns
 * its URL normalisation and reasoning-channel stripping.
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
    _opts: LlmProviderCallOpts,
  ): Promise<string> {
    const url = localLlmConfig.url.endsWith("/v1/chat/completions")
      ? localLlmConfig.url
      : `${localLlmConfig.url.replace(/\/$/, "")}/v1/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: localLlmConfig.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: localLlmConfig.maxTokens,
        temperature: localLlmConfig.temperature,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Local LLM error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string | null } }>;
    };
    const raw = data.choices[0]?.message?.content ?? "";
    return stripThinkingChannels(raw);
  }
}

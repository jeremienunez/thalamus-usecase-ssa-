/**
 * KimiProvider — Moonshot Kimi K2 chat completions (primary).
 *
 * Owns its own global rate limiter (2s min spacing) — Kimi-specific concern,
 * not cross-provider policy, so it lives here rather than on the orchestrator.
 * Logs fabrication signals observed in `reasoning_content`.
 */

import { createLogger } from "@interview/shared/observability";
import {
  getEnrichmentConfig,
  getEnrichmentConfigSnapshot,
} from "../../config/enrichment";
import { stripThinkingChannels } from "./strip-thinking";
import type { LlmProvider, LlmProviderCallOpts } from "./types";

const logger = createLogger("llm-provider-kimi");

export class KimiProvider implements LlmProvider {
  readonly name = "kimi" as const;
  private config = getEnrichmentConfigSnapshot();

  /** Global rate limiter — minimum ms between Kimi calls (Kimi-specific). */
  private static lastKimiCallMs = 0;
  private static readonly KIMI_MIN_INTERVAL_MS = 2000;

  async refreshConfig(): Promise<void> {
    this.config = await getEnrichmentConfig();
  }

  isEnabled(): boolean {
    return Boolean(this.config.apiKey);
  }

  async call(
    systemPrompt: string,
    userPrompt: string,
    opts: LlmProviderCallOpts,
  ): Promise<string> {
    await this.refreshConfig();
    const config = this.config;
    // Global rate limiter — wait if we're calling too fast
    const now = Date.now();
    const elapsed = now - KimiProvider.lastKimiCallMs;
    if (elapsed < KimiProvider.KIMI_MIN_INTERVAL_MS) {
      await new Promise((r) =>
        setTimeout(r, KimiProvider.KIMI_MIN_INTERVAL_MS - elapsed),
      );
    }
    KimiProvider.lastKimiCallMs = Date.now();

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const tools = opts.enableWebSearch
      ? [{ type: "builtin_function", function: { name: "$web_search" } }]
      : undefined;

    const model = opts.model ?? config.model;
    // Moonshot prefers `max_completion_tokens` (max_tokens is deprecated).
    const maxTokens =
      opts.maxOutputTokens && opts.maxOutputTokens > 0
        ? opts.maxOutputTokens
        : config.maxTokens;
    const temperature =
      typeof opts.temperature === "number" ? opts.temperature : 1.0;

    const body: Record<string, unknown> = {
      model,
      messages,
      max_completion_tokens: maxTokens,
      temperature,
      ...(tools ? { tools } : {}),
    };

    // Kimi K2.5 / K2-thinking thinking toggle. Omit when undefined so
    // non-thinking K2 doesn't receive an unexpected param.
    if (typeof opts.thinking === "boolean") {
      body.thinking = { type: opts.thinking ? "enabled" : "disabled" };
    }

    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Kimi K2 API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          reasoning_content?: string | null;
          tool_calls?: Array<{ function: { name: string; arguments: string } }>;
        };
      }>;
    };
    const msg = data.choices[0]?.message;
    if (!msg) return "";

    if (msg.reasoning_content) {
      // Detect fabrication signals in reasoning chain
      const reasoning = msg.reasoning_content;
      const fabricationPatterns =
        /\b(I think|I recall|I believe|typically|generally known|commonly|from my knowledge|as far as I know|usually reported)\b/gi;
      const fabricationMatches = reasoning.match(fabricationPatterns) ?? [];

      logger.info(
        {
          reasoningLen: reasoning.length,
          contentLen: (msg.content ?? "").length,
          fabricationSignals: fabricationMatches.length,
          ...(fabricationMatches.length > 0
            ? { signals: fabricationMatches.slice(0, 5) }
            : {}),
        },
        fabricationMatches.length > 0
          ? "Kimi thinking: fabrication signals detected in reasoning"
          : "Kimi thinking: reasoning_content present",
      );
    }

    return stripThinkingChannels(msg.content ?? "");
  }
}

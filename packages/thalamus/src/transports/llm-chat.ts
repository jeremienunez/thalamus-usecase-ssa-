/**
 * LlmChatTransport — Shared LLM chat completion transport
 *
 * Kimi K2 (primary) -> OpenAI (fallback) -> none
 * Circuit breaker: 3 consecutive Kimi failures -> auto-switch to OpenAI
 *
 * Extracted from SatelliteEnrichmentOrchestrator + LlmEnricher (identical patterns).
 */

import { retry } from "@interview/shared/utils";
import { createLogger } from "@interview/shared/observability";
import {
  enrichmentConfig,
  enrichmentFallbackConfig,
  isKimiEnabled,
  isLocalLlmEnabled,
  localLlmConfig,
} from "../config/enrichment";
import type { z } from "zod";
import type { LlmChatConfig, LlmResponse, LlmTransport } from "./types";

export type { LlmChatConfig, LlmResponse, LlmTransport };

const logger = createLogger("llm-chat-transport");

// ============================================================================
// LlmChatTransport
// ============================================================================

export class LlmChatTransport {
  /** Shared across ALL instances — if Kimi is down, we don't spam it */
  private static kimiConsecutiveFailures = 0;
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 3;
  /** Global rate limiter — minimum ms between Kimi calls */
  private static lastKimiCallMs = 0;
  private static readonly KIMI_MIN_INTERVAL_MS = 2000;
  private readonly maxRetries: number;

  constructor(private config: LlmChatConfig) {
    this.maxRetries = config.maxRetries ?? enrichmentConfig.maxRetries;
  }

  /**
   * Call LLM with Kimi K2 primary -> OpenAI fallback -> none
   */
  async call(userPrompt: string): Promise<LlmResponse> {
    if (isLocalLlmEnabled()) {
      try {
        const content = await retry(() => this.callLocal(userPrompt), {
          maxAttempts: this.maxRetries,
          delayMs: 500,
          backoff: "exponential",
        });
        return { content, provider: "local" };
      } catch (error) {
        logger.warn(
          { error: (error as Error).message },
          "Local LLM call failed — falling through to remote providers",
        );
      }
    }

    const kimiOpen =
      LlmChatTransport.kimiConsecutiveFailures <
      LlmChatTransport.CIRCUIT_BREAKER_THRESHOLD;

    if (isKimiEnabled() && kimiOpen) {
      try {
        const content = await retry(() => this.callKimi(userPrompt), {
          maxAttempts: this.maxRetries,
          delayMs: 1000,
          backoff: "exponential",
          onRetry: (attempt, error) => {
            logger.debug(
              { attempt, error: error.message },
              "Retrying Kimi K2 call",
            );
          },
        });
        LlmChatTransport.kimiConsecutiveFailures = 0;
        return { content, provider: "kimi" };
      } catch {
        LlmChatTransport.kimiConsecutiveFailures++;
        if (
          LlmChatTransport.kimiConsecutiveFailures >=
          LlmChatTransport.CIRCUIT_BREAKER_THRESHOLD
        ) {
          logger.warn("Kimi K2 circuit breaker tripped — switching to OpenAI");
        }
      }
    }

    if (enrichmentFallbackConfig.openaiApiKey) {
      try {
        const content = await retry(() => this.callOpenAI(userPrompt), {
          maxAttempts: this.maxRetries,
          delayMs: 1000,
          backoff: "exponential",
        });
        return { content, provider: "openai" };
      } catch {
        logger.warn("OpenAI fallback also failed");
      }
    }

    return { content: "", provider: "none" };
  }

  /**
   * Parse JSON from LLM text response (handles markdown code blocks)
   * Static — usable without instantiation
   */
  static parseJson<T>(content: string, schema: z.ZodType<T>): T {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object found in LLM response");
    const raw = JSON.parse(jsonMatch[0]);
    return schema.parse(raw);
  }

  // ==========================================================================
  // Private: HTTP Calls
  // ==========================================================================

  private async callLocal(userPrompt: string): Promise<string> {
    const url = localLlmConfig.url.endsWith("/v1/chat/completions")
      ? localLlmConfig.url
      : `${localLlmConfig.url.replace(/\/$/, "")}/v1/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: localLlmConfig.model,
        messages: [
          { role: "system", content: this.config.systemPrompt },
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
    return data.choices[0]?.message?.content ?? "";
  }

  private async callKimi(userPrompt: string): Promise<string> {
    // Global rate limiter — wait if we're calling too fast
    const now = Date.now();
    const elapsed = now - LlmChatTransport.lastKimiCallMs;
    if (elapsed < LlmChatTransport.KIMI_MIN_INTERVAL_MS) {
      await new Promise((r) =>
        setTimeout(r, LlmChatTransport.KIMI_MIN_INTERVAL_MS - elapsed),
      );
    }
    LlmChatTransport.lastKimiCallMs = Date.now();

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: this.config.systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const tools = this.config.enableWebSearch
      ? [{ type: "builtin_function", function: { name: "$web_search" } }]
      : undefined;

    const response = await fetch(enrichmentConfig.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${enrichmentConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: enrichmentConfig.model,
        messages,
        max_tokens: enrichmentConfig.maxTokens,
        temperature: 1.0, // Required for thinking models (kimi-k2.5)
        ...(tools ? { tools } : {}),
      }),
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

    return msg.content ?? "";
  }

  private async callOpenAI(userPrompt: string): Promise<string> {
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
        instructions: this.config.systemPrompt,
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

/**
 * Factory: create LlmChatTransport with standard defaults.
 * Single import point — eliminates 8× scattered `new LlmChatTransport()` (#38 fix).
 */
export function createLlmTransport(
  systemPrompt: string,
  opts?: { maxRetries?: number; enableWebSearch?: boolean },
): LlmChatTransport {
  return new LlmChatTransport({
    systemPrompt,
    maxRetries: opts?.maxRetries ?? 2,
    enableWebSearch: opts?.enableWebSearch,
  });
}


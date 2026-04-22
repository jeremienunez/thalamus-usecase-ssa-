/**
 * LlmChatTransport — thin orchestrator over an ordered list of `LlmProvider`s.
 *
 * Providers (local → Kimi K2 → OpenAI by default) own their own HTTP shape
 * and provider-specific state (e.g. Kimi's rate limiter). The orchestrator
 * applies cross-provider policy only:
 *   - per-provider retry with exponential backoff
 *   - global circuit breaker for Kimi (3 consecutive failures → skip)
 *
 * Adding a new backend = new `LlmProvider` implementation + factory update.
 * The orchestrator is closed for modification, open for extension.
 */

import { retry } from "@interview/shared/utils";
import { createLogger } from "@interview/shared/observability";
import type { z } from "zod";
import type { LlmChatConfig, LlmResponse, LlmTransport } from "./types";
import { getThalamusTransportConfig } from "../config/transport-config";
import {
  KimiProvider,
  LocalProvider,
  MiniMaxProvider,
  OpenAIProvider,
  type LlmProvider,
} from "./providers";

export type { LlmChatConfig, LlmResponse, LlmTransport };

const logger = createLogger("llm-chat-transport");

// ============================================================================
// LlmChatTransport — orchestrator
// ============================================================================

export class LlmChatTransport {
  /** Shared across ALL instances — if Kimi is down, we don't spam it */
  private static kimiConsecutiveFailures = 0;
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 3;

  private readonly providers: LlmProvider[];
  private readonly config: LlmChatConfig;

  constructor(config: LlmChatConfig, providers: LlmProvider[]) {
    this.config = config;
    this.providers = providers;
  }

  /**
   * Walk providers in priority order, apply retry + circuit-breaker policy,
   * return the first success. Falls back to `{ content: "", provider: "none" }`
   * when every enabled provider errors out.
   */
  async call(userPrompt: string): Promise<LlmResponse> {
    // Reorder chain so the preferred provider (if set and enabled) is
    // tried first. Fallback order preserved for the rest.
    const ordered = this.config.preferredProvider
      ? [
          ...this.providers.filter(
            (p) => p.name === this.config.preferredProvider,
          ),
          ...this.providers.filter(
            (p) => p.name !== this.config.preferredProvider,
          ),
        ]
      : this.providers;

    await Promise.all(ordered.map((provider) => provider.refreshConfig?.()));
    const transportConfig = await getThalamusTransportConfig();
    const maxRetries = this.config.maxRetries ?? transportConfig.llmMaxRetries;

    for (const provider of ordered) {
      if (!provider.isEnabled()) continue;

      // Circuit breaker: skip Kimi after N consecutive failures
      if (
        provider.name === "kimi" &&
        LlmChatTransport.kimiConsecutiveFailures >=
          LlmChatTransport.CIRCUIT_BREAKER_THRESHOLD
      ) {
        continue;
      }

      try {
        // Model override only applies to the preferred provider — when
        // the chain falls through to a different backend, reusing e.g.
        // `kimi-k2-turbo-preview` on OpenAI yields a guaranteed 404.
        // The non-model overrides (reasoning effort, thinking, etc.)
        // are still forwarded; each provider ignores what it doesn't
        // natively understand.
        const isPreferred =
          !this.config.preferredProvider ||
          provider.name === this.config.preferredProvider;
        const overrides = this.config.overrides ?? {};
        const callOverrides = isPreferred
          ? overrides
          : (({ model: _drop, ...rest }) => rest)(overrides);
        const content = await retry(
          () =>
            provider.call(this.config.systemPrompt, userPrompt, {
              ...callOverrides,
              enableWebSearch: this.config.enableWebSearch,
            }),
          {
            maxAttempts: maxRetries,
            delayMs: provider.name === "local" ? 500 : 1000,
            backoff: "exponential",
            onRetry:
              provider.name === "kimi"
                ? (attempt, error) => {
                    logger.debug(
                      { attempt, error: error.message },
                      "Retrying Kimi K2 call",
                    );
                  }
                : undefined,
          },
        );

        if (provider.name === "kimi") {
          LlmChatTransport.kimiConsecutiveFailures = 0;
        }
        return { content, provider: provider.name };
      } catch (error) {
        if (provider.name === "kimi") {
          LlmChatTransport.kimiConsecutiveFailures++;
          if (
            LlmChatTransport.kimiConsecutiveFailures >=
            LlmChatTransport.CIRCUIT_BREAKER_THRESHOLD
          ) {
            logger.warn(
              "Kimi K2 circuit breaker tripped — switching to OpenAI",
            );
          }
        } else if (provider.name === "local") {
          logger.warn(
            { error: (error as Error).message },
            "Local LLM call failed — falling through to remote providers",
          );
        } else if (provider.name === "openai") {
          logger.warn("OpenAI fallback also failed");
        }
      }
    }

    return { content: "", provider: "none" };
  }

  /**
   * Parse JSON from LLM text response (handles markdown code blocks).
   * Static — usable without instantiation. Kept on the orchestrator because
   * it is a cross-provider utility, not a provider-specific parser.
   */
  static parseJson<T>(content: string, schema: z.ZodType<T>): T {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object found in LLM response");
    const raw = JSON.parse(jsonMatch[0]);
    return schema.parse(raw);
  }
}

/**
 * Factory: create `LlmChatTransport` with the default provider chain
 * (local → Kimi K2 → OpenAI). Single import point — eliminates scattered
 * `new LlmChatTransport()` constructions and the provider ordering decision.
 */
export function createLlmTransport(
  systemPrompt: string,
  opts?: {
    maxRetries?: number;
    enableWebSearch?: boolean;
    preferredProvider?: LlmChatConfig["preferredProvider"];
    overrides?: LlmChatConfig["overrides"];
  },
): LlmChatTransport {
  return new LlmChatTransport(
    {
      systemPrompt,
      maxRetries: opts?.maxRetries ?? 2,
      enableWebSearch: opts?.enableWebSearch,
      preferredProvider: opts?.preferredProvider,
      overrides: opts?.overrides,
    },
    [
      new LocalProvider(),
      new KimiProvider(),
      new MiniMaxProvider(),
      new OpenAIProvider(),
    ],
  );
}

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

import { createLogger } from "@interview/shared/observability";
import type { z } from "zod";
import type {
  LlmChatConfig,
  LlmResponse,
  LlmTransport,
  LlmTransportCallOptions,
} from "./types";
import { getThalamusTransportConfig } from "../config/transport-config";
import { extractJsonObject } from "@interview/shared/utils";
import { abortableDelay, isAbortError, throwIfAborted } from "./abort";
import {
  KimiProvider,
  LocalProvider,
  MiniMaxProvider,
  OpenAIProvider,
  type LlmProvider,
} from "./providers";

export type { LlmChatConfig, LlmResponse, LlmTransport };

const logger = createLogger("llm-chat-transport");

export type LlmProviderFailure = {
  provider: string;
  message: string;
};

export class LlmUnavailableError extends Error {
  constructor(
    public readonly attemptedProviders: string[],
    public readonly failures: LlmProviderFailure[],
  ) {
    super("All LLM providers failed or were unavailable");
    this.name = "LlmUnavailableError";
  }
}

type CircuitState = "closed" | "open" | "half_open";

// ============================================================================
// LlmChatTransport — orchestrator
// ============================================================================

export class LlmChatTransport {
  /** Shared across ALL instances — if Kimi is down, we don't spam it */
  private static kimiConsecutiveFailures = 0;
  private static kimiCircuitState: CircuitState = "closed";
  private static kimiCircuitOpenedAt: number | null = null;
  private static kimiHalfOpenProbeInFlight = false;
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 3;
  private static readonly KIMI_CIRCUIT_COOLDOWN_MS = 60_000;

  private readonly providers: LlmProvider[];
  private readonly config: LlmChatConfig;

  constructor(config: LlmChatConfig, providers: LlmProvider[]) {
    this.config = config;
    this.providers = providers;
  }

  /**
   * Walk providers in priority order, apply retry + circuit-breaker policy,
   * return the first success. Throws `LlmUnavailableError` when no provider
   * can produce a response.
   */
  async call(
    userPrompt: string,
    options?: LlmTransportCallOptions,
  ): Promise<LlmResponse> {
    throwIfAborted(options?.signal);
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

    const transportConfig = await getThalamusTransportConfig();
    const maxRetries = this.config.maxRetries ?? transportConfig.llmMaxRetries;
    const failures: LlmProviderFailure[] = [];
    const attemptedProviders: string[] = [];

    for (const provider of ordered) {
      try {
        throwIfAborted(options?.signal);
        await provider.refreshConfig?.();
      } catch (error) {
        if (isAbortError(error)) throw error;
        const message =
          error instanceof Error ? error.message : String(error);
        attemptedProviders.push(provider.name);
        failures.push({ provider: provider.name, message });
        continue;
      }

      if (!provider.isEnabled()) {
        failures.push({
          provider: provider.name,
          message: "provider disabled",
        });
        continue;
      }

      // Circuit breaker: skip Kimi after N consecutive failures
      if (
        provider.name === "kimi" &&
        LlmChatTransport.shouldSkipKimi(Date.now())
      ) {
        failures.push({
          provider: provider.name,
          message: "Kimi circuit breaker open",
        });
        continue;
      }

      try {
        throwIfAborted(options?.signal);
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
        attemptedProviders.push(provider.name);
        const content = await this.retryProviderCall(
          () =>
            provider.call(this.config.systemPrompt, userPrompt, {
              ...callOverrides,
              enableWebSearch: this.config.enableWebSearch,
              ...(options?.signal ? { signal: options.signal } : {}),
            }),
          {
            maxAttempts: maxRetries,
            delayMs: provider.name === "local" ? 500 : 1000,
            signal: options?.signal,
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
          LlmChatTransport.recordKimiSuccess();
        }
        return { content, provider: provider.name };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ provider: provider.name, message });
        if (isAbortError(error)) throw error;

        if (provider.name === "kimi") {
          const tripped = LlmChatTransport.recordKimiFailure(Date.now());
          if (tripped) {
            logger.warn(
              "Kimi K2 circuit breaker tripped — switching to OpenAI",
            );
          }
        } else if (provider.name === "local") {
          logger.warn(
            { error: message },
            "Local LLM call failed — falling through to remote providers",
          );
        } else if (provider.name === "openai") {
          logger.warn("OpenAI fallback also failed");
        }
      }
    }

    throw new LlmUnavailableError(attemptedProviders, failures);
  }

  private async retryProviderCall<T>(
    fn: () => Promise<T>,
    options: {
      maxAttempts: number;
      delayMs: number;
      signal?: AbortSignal;
      onRetry?: (attempt: number, error: Error) => void;
    },
  ): Promise<T> {
    let lastError: Error | undefined;
    const maxAttempts = Number.isFinite(options.maxAttempts)
      ? Math.max(1, Math.floor(options.maxAttempts))
      : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      throwIfAborted(options.signal);
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (isAbortError(lastError)) throw lastError;
        if (attempt < maxAttempts) {
          options.onRetry?.(attempt, lastError);
          await abortableDelay(
            options.delayMs * Math.pow(2, attempt - 1),
            options.signal,
          );
        }
      }
    }

    throw lastError ?? new Error("LLM provider failed");
  }

  private static shouldSkipKimi(now: number): boolean {
    if (LlmChatTransport.kimiCircuitState === "half_open") {
      if (LlmChatTransport.kimiHalfOpenProbeInFlight) return true;
      LlmChatTransport.kimiHalfOpenProbeInFlight = true;
      return false;
    }
    if (LlmChatTransport.kimiCircuitState !== "open") return false;
    const openedAt = LlmChatTransport.kimiCircuitOpenedAt ?? now;
    if (now - openedAt >= LlmChatTransport.KIMI_CIRCUIT_COOLDOWN_MS) {
      LlmChatTransport.kimiCircuitState = "half_open";
      if (LlmChatTransport.kimiHalfOpenProbeInFlight) return true;
      LlmChatTransport.kimiHalfOpenProbeInFlight = true;
      return false;
    }
    return true;
  }

  private static recordKimiSuccess(): void {
    LlmChatTransport.kimiConsecutiveFailures = 0;
    LlmChatTransport.kimiCircuitState = "closed";
    LlmChatTransport.kimiCircuitOpenedAt = null;
    LlmChatTransport.kimiHalfOpenProbeInFlight = false;
  }

  private static recordKimiFailure(now: number): boolean {
    LlmChatTransport.kimiConsecutiveFailures++;
    if (
      LlmChatTransport.kimiCircuitState === "half_open" ||
      LlmChatTransport.kimiConsecutiveFailures >=
        LlmChatTransport.CIRCUIT_BREAKER_THRESHOLD
    ) {
      LlmChatTransport.kimiCircuitState = "open";
      LlmChatTransport.kimiCircuitOpenedAt = now;
      LlmChatTransport.kimiHalfOpenProbeInFlight = false;
      return true;
    }
    return false;
  }

  /**
   * Parse JSON from LLM text response (handles markdown code blocks).
   * Static — usable without instantiation. Kept on the orchestrator because
   * it is a cross-provider utility, not a provider-specific parser.
   */
  static parseJson<T>(content: string, schema: z.ZodType<T>): T {
    const raw = extractJsonObject(content);
    if (Object.keys(raw).length === 0 && !content.includes("{")) {
      throw new Error("No JSON object found in LLM response");
    }
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
      maxRetries: opts?.maxRetries,
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

/**
 * LlmProvider — strategy contract for a single chat-completion backend.
 *
 * The orchestrator (`LlmChatTransport`) iterates providers in priority order
 * and applies cross-provider policy (retry, circuit breaker). Each provider
 * owns its HTTP shape, parsing, and provider-specific state (e.g. Kimi's
 * rate limiter). Adding a new provider = drop a new file in this folder
 * and register it in the factory — no edits to the orchestrator.
 */

export type ProviderName = "local" | "kimi" | "openai" | "minimax";

/**
 * Runtime per-call overrides. Every field is optional; providers read only
 * what they natively support and ignore the rest — matches the ModelPreset
 * `supports` map exposed to the UI. Semantics are deliberately identical
 * to `ThalamusPlannerConfig` so the planner can pass through 1:1.
 */
export interface LlmProviderCallOpts {
  /** Enable web-search tool for the call (provider-specific support). */
  enableWebSearch?: boolean;

  /** Override model id. Falls back to the provider's env-configured model. */
  model?: string;
  /** Cap on generated tokens (0 = provider default).
   *  OpenAI → `max_output_tokens`, Kimi → `max_completion_tokens`,
   *  llama.cpp → `max_tokens`. */
  maxOutputTokens?: number;
  /** Sampling temperature. Some thinking models force 1.0 regardless. */
  temperature?: number;

  /** OpenAI `reasoning.effort`: none | low | medium | high | xhigh. */
  reasoningEffort?: string;
  /** OpenAI `text.verbosity`: low | medium | high. */
  verbosity?: string;

  /** Kimi K2.5 / K2-thinking + Gemma 4 thinking toggle. */
  thinking?: boolean;
  /** llama.cpp server `reasoning_format`: none | deepseek | deepseek-legacy. */
  reasoningFormat?: string;
  /** MiniMax OpenAI-compat `reasoning_split`. */
  reasoningSplit?: boolean;

  /** Abort in-flight provider HTTP calls and retry delays. */
  signal?: AbortSignal;
}

export interface LlmProvider {
  /** Canonical provider tag, surfaced in `LlmResponse.provider`. */
  readonly name: ProviderName;
  /** Refresh any provider-local config snapshot before `isEnabled()` gates. */
  refreshConfig?(): Promise<void>;
  /** Runtime check — skip this provider when config/env is incomplete. */
  isEnabled(): boolean;
  /** Execute a single chat completion. Throws on error; retry is caller's job. */
  call(
    systemPrompt: string,
    userPrompt: string,
    opts: LlmProviderCallOpts,
  ): Promise<string>;
}

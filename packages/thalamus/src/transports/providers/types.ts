/**
 * LlmProvider — strategy contract for a single chat-completion backend.
 *
 * The orchestrator (`LlmChatTransport`) iterates providers in priority order
 * and applies cross-provider policy (retry, circuit breaker). Each provider
 * owns its HTTP shape, parsing, and provider-specific state (e.g. Kimi's
 * rate limiter). Adding a new provider = drop a new file in this folder
 * and register it in the factory — no edits to the orchestrator.
 */

export interface LlmProviderCallOpts {
  /** Enable web-search tool for the call (provider-specific support). */
  enableWebSearch?: boolean;
}

export interface LlmProvider {
  /** Canonical provider tag, surfaced in `LlmResponse.provider`. */
  readonly name: "local" | "kimi" | "openai";
  /** Runtime check — skip this provider when config/env is incomplete. */
  isEnabled(): boolean;
  /** Execute a single chat completion. Throws on error; retry is caller's job. */
  call(
    systemPrompt: string,
    userPrompt: string,
    opts: LlmProviderCallOpts,
  ): Promise<string>;
}

/**
 * Transport layer domain contract.
 *
 * Keeping the interface here (instead of inside llm-chat.ts) lets
 * fixture-transport.ts depend on the contract without creating a cycle
 * back to the concrete LlmChatTransport class.
 */

import type { LlmProviderCallOpts, ProviderName } from "./providers/types";

export interface LlmChatConfig {
  /** System prompt sent as first message */
  systemPrompt: string;
  /** Max retries per provider */
  maxRetries?: number;
  /** Enable Kimi web search tool ($0.005/call) */
  enableWebSearch?: boolean;
  /** Preferred provider — orchestrator tries this one first. Others still
   *  run as fallback if the preferred provider errors or is disabled. */
  preferredProvider?: ProviderName;
  /** Runtime per-call overrides forwarded to every provider (each reads
   *  only what it natively supports). */
  overrides?: Omit<LlmProviderCallOpts, "enableWebSearch" | "signal">;
}

export interface LlmResponse {
  content: string;
  provider: ProviderName | "none";
}

/** Generic LLM transport — `call(userPrompt) → LlmResponse`. */
export interface LlmTransportCallOptions {
  signal?: AbortSignal;
}

export interface LlmTransport {
  call(
    userPrompt: string,
    options?: LlmTransportCallOptions,
  ): Promise<LlmResponse>;
}

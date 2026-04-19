/**
 * LLM provider strategy pack — one file per backend.
 *
 * The orchestrator (`LlmChatTransport`) consumes an ordered `LlmProvider[]`
 * and applies retry + circuit-breaker policy around each call.
 */

export type { LlmProvider, LlmProviderCallOpts, ProviderName } from "./types";
export { LocalProvider } from "./local.provider";
export { KimiProvider } from "./kimi.provider";
export { OpenAIProvider } from "./openai.provider";
export { MiniMaxProvider } from "./minimax.provider";
export { stripThinkingChannels } from "./strip-thinking";

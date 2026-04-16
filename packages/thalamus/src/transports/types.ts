/**
 * Transport layer domain contract.
 *
 * Keeping the interface here (instead of inside llm-chat.ts) lets
 * fixture-transport.ts depend on the contract without creating a cycle
 * back to the concrete LlmChatTransport class.
 */

export interface LlmChatConfig {
  /** System prompt sent as first message */
  systemPrompt: string;
  /** Max retries per provider */
  maxRetries?: number;
  /** Enable Kimi web search tool ($0.005/call) */
  enableWebSearch?: boolean;
}

export interface LlmResponse {
  content: string;
  provider: "local" | "kimi" | "openai" | "none";
}

/** Generic LLM transport — `call(userPrompt) → LlmResponse`. */
export interface LlmTransport {
  call(userPrompt: string): Promise<LlmResponse>;
}

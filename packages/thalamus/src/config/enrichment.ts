/**
 * LLM provider config — Kimi K2 primary, OpenAI fallback.
 *
 * Single source for all LLM transport config used by the explorer, cortex
 * executor, planner, and reflexion. Values read from `process.env` at import
 * time; no schema validation here (that belongs to a future `shared/config/env`).
 *
 * For the SSA interview artifact we inline the reads here so the thalamus
 * package is self-contained.
 */

export const enrichmentConfig = {
  url:
    process.env.KIMI_API_URL ??
    process.env.MOONSHOT_API_URL ??
    "https://api.moonshot.ai/v1/chat/completions",
  apiKey: process.env.MOONSHOT_API_KEY ?? process.env.KIMI_API_KEY ?? "",
  model: process.env.KIMI_MODEL ?? "kimi-k2-turbo-preview",
  maxTokens: Number(process.env.KIMI_MAX_TOKENS ?? 8192),
  maxRetries: Number(process.env.LLM_MAX_RETRIES ?? 2),
} as const;

export const enrichmentFallbackConfig = {
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  model: process.env.OPENAI_FALLBACK_MODEL ?? "gpt-5-nano",
} as const;

export const isKimiEnabled = (): boolean => Boolean(enrichmentConfig.apiKey);

/**
 * Local LLM (llama.cpp / Ollama / vLLM) — OpenAI-compatible endpoint.
 *
 * When `LOCAL_LLM_URL` is set, the transport routes through the local server
 * first (provider="local"), bypassing Kimi/OpenAI entirely. Used for fully
 * offline / sovereign demos (e.g. Gemma 4 on llama.cpp Vulkan backend).
 */
export const localLlmConfig = {
  url: process.env.LOCAL_LLM_URL ?? "",
  model: process.env.LOCAL_LLM_MODEL ?? "local",
  maxTokens: Number(process.env.LOCAL_LLM_MAX_TOKENS ?? 2048),
  temperature: Number(process.env.LOCAL_LLM_TEMPERATURE ?? 0.3),
} as const;

export const isLocalLlmEnabled = (): boolean => Boolean(localLlmConfig.url);

/**
 * MiniMax (M-series) — OpenAI-compatible endpoint.
 * Returned reasoning lives in `message.reasoning_content`; runtime knob is
 * `reasoning_split` (boolean) on the request.
 */
export const minimaxConfig = {
  url:
    process.env.MINIMAX_API_URL ??
    "https://api.minimaxi.chat/v1/text/chatcompletion_v2",
  apiKey: process.env.MINIMAX_API_KEY ?? "",
  model: process.env.MINIMAX_MODEL ?? "MiniMax-M2.7",
  maxTokens: Number(process.env.MINIMAX_MAX_TOKENS ?? 8192),
} as const;

export const isMinimaxEnabled = (): boolean => Boolean(minimaxConfig.apiKey);

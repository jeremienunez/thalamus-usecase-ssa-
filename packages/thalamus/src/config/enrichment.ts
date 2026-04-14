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

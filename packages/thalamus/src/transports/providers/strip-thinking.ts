/**
 * Strip reasoning/thinking-channel markers that thinking models leak into
 * the content stream:
 *   - `<think>…</think>` — DeepSeek-R1, Kimi K2.5, MiniMax M2.7 inline
 *   - `<|channel>…<channel|>` — unsloth Gemma 4 26B-A4B local GGUFs
 *   - stray `<thought>` / `<thinking>` markers from misbehaving templates
 *
 * Applied uniformly across every LlmProvider so `<think>` never reaches the
 * UI, even when the provider's native reasoning channel was expected to be
 * returned separately.
 */
export function stripThinkingChannels(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\|channel>[\s\S]*?<channel\|>/g, "")
    .replace(/<\|?channel\|?>/g, "")
    .replace(/<\|?thought\|?>/g, "")
    .replace(/<\/?think>/gi, "")
    .replace(/<\/?thinking>/gi, "")
    .trim();
}

/**
 * Strip reasoning/thinking-channel markers that some local chat GGUFs (e.g.
 * unsloth Gemma 4 26B-A4B) leak into the content stream.
 *
 * Drops everything up to and including the final `<channel|>` closer, plus any
 * stray marker tokens that slip through.
 */
export function stripThinkingChannels(raw: string): string {
  return raw
    .replace(/<\|channel>[\s\S]*?<channel\|>/g, "")
    .replace(/<\|?channel\|?>/g, "")
    .replace(/<\|?thought\|?>/g, "")
    .trim();
}

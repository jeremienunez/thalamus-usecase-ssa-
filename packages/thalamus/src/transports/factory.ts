/**
 * Mode-aware LLM transport factory.
 *
 * Routes on `process.env.THALAMUS_MODE`:
 *   - "cloud"     → real LlmChatTransport (default)
 *   - "fixtures"  → FixtureLlmTransport (read-only, throws on miss)
 *   - "record"    → FixtureLlmTransport (write-through over real transport)
 *
 * Lives in its own module (static imports of both concrete transports) so the
 * historical `llm-chat` ⇄ `fixture-transport` cycle stays broken.
 */

import { createLlmTransport } from "./llm-chat";
import { FixtureLlmTransport } from "./fixture-transport";
import type { LlmTransport } from "./types";

export function createLlmTransportWithMode(
  systemPrompt: string,
  opts?: { maxRetries?: number; enableWebSearch?: boolean },
): LlmTransport {
  const mode = (process.env.THALAMUS_MODE ?? "cloud").toLowerCase();
  const real = createLlmTransport(systemPrompt, opts);
  if (mode === "cloud") return real;

  if (mode === "fixtures") {
    return new FixtureLlmTransport({
      systemPrompt,
      mode: "fixtures",
      fallbackFixture: process.env.FIXTURES_FALLBACK || undefined,
    });
  }
  if (mode === "record") {
    return new FixtureLlmTransport({
      systemPrompt,
      mode: "record",
      realTransport: real,
    });
  }
  return real;
}

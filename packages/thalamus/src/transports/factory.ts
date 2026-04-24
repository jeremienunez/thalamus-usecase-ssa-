/**
 * Mode-aware LLM transport factory.
 *
 * Routes on the injected transport config mode:
 *   - "cloud"     → real LlmChatTransport (default)
 *   - "fixtures"  → FixtureLlmTransport (read-only, throws on miss)
 *   - "record"    → FixtureLlmTransport (write-through over real transport)
 *
 * Lives in its own module (static imports of both concrete transports) so the
 * historical `llm-chat` ⇄ `fixture-transport` cycle stays broken.
 */

import { createLlmTransport } from "./llm-chat";
import { FixtureLlmTransport } from "./fixture-transport";
import {
  getThalamusTransportConfig,
  resolveFixturesDir,
} from "../config/transport-config";
import type {
  LlmChatConfig,
  LlmTransport,
  LlmTransportCallOptions,
} from "./types";

class ModeAwareLlmTransport implements LlmTransport {
  constructor(
    private readonly systemPrompt: string,
    private readonly real: LlmTransport,
  ) {}

  async call(userPrompt: string, options?: LlmTransportCallOptions) {
    const config = await getThalamusTransportConfig();
    if (config.mode === "cloud") {
      return options
        ? this.real.call(userPrompt, options)
        : this.real.call(userPrompt);
    }
    const fixtureTransport = new FixtureLlmTransport({
      systemPrompt: this.systemPrompt,
      mode: config.mode,
      realTransport: config.mode === "record" ? this.real : undefined,
      fixturesDir: resolveFixturesDir(config.fixturesDir),
      fallbackFixture: config.fallbackFixture || undefined,
    });
    return options
      ? fixtureTransport.call(userPrompt, options)
      : fixtureTransport.call(userPrompt);
  }
}

export function createLlmTransportWithMode(
  systemPrompt: string,
  opts?: {
    maxRetries?: number;
    enableWebSearch?: boolean;
    preferredProvider?: LlmChatConfig["preferredProvider"];
    overrides?: LlmChatConfig["overrides"];
  },
): LlmTransport {
  const real = createLlmTransport(systemPrompt, opts);
  return new ModeAwareLlmTransport(systemPrompt, real);
}

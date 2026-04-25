/**
 * OpenAI Web Search adapter — implements `WebSearchPort` against the
 * OpenAI Responses API with the `web_search_preview` tool.
 *
 * Also exports `NullWebSearchAdapter` for environments without an API
 * key (returns `""`, so the executor silently skips web enrichment).
 */

import { createLogger } from "@interview/shared/observability";
import type { WebSearchPort } from "../ports/web-search.port";
import { isAbortError, throwIfAborted } from "./abort";
import { LlmChatTransport } from "./llm-chat";
import { KimiProvider } from "./providers";
import type { LlmTransport } from "./types";

const logger = createLogger("openai-web-search");

export interface OpenAIWebSearchAdapterOptions {
  /**
   * Defaults to a Kimi-only transport with Kimi's builtin web-search tool.
   * Tests may inject a fake transport; set to `null` to disable fallback.
   */
  fallbackTransportFactory?: (() => LlmTransport) | null;
  fallbackMaxOutputTokens?: number;
}

export class OpenAIWebSearchAdapter implements WebSearchPort {
  private readonly fallbackTransportFactory: (() => LlmTransport) | null;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    options: OpenAIWebSearchAdapterOptions = {},
  ) {
    this.fallbackTransportFactory =
      options.fallbackTransportFactory === undefined
        ? () =>
            createKimiWebSearchFallbackTransport(
              options.fallbackMaxOutputTokens,
            )
        : options.fallbackTransportFactory;
  }

  async search(
    instruction: string,
    _query: string,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    try {
      throwIfAborted(options?.signal);
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          tools: [{ type: "web_search_preview" }],
          input: instruction,
        }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      if (!response.ok) {
        logger.debug({ status: response.status }, "Web search failed");
        if (response.status === 429 || response.status >= 500) {
          return this.searchWithFallback(
            instruction,
            _query,
            `openai_http_${response.status}`,
            options,
          );
        }
        return "";
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await response.json()) as Record<string, any>;
      const text =
        data.output
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.filter((o: any) => o.type === "message")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((o: any) => o.content?.map((c: any) => c.text).join(""))
          .join("\n") ?? "";

      return text.trim()
        ? text
        : await this.searchWithFallback(
            instruction,
            _query,
            "openai_empty_response",
            options,
          );
    } catch (err) {
      if (isAbortError(err)) throw err;
      logger.debug({ err }, "Web search failed");
      return this.searchWithFallback(
        instruction,
        _query,
        "openai_exception",
        options,
      );
    }
  }

  private async searchWithFallback(
    instruction: string,
    query: string,
    reason: string,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    if (!this.fallbackTransportFactory) return "";

    try {
      throwIfAborted(options?.signal);
      const fallback = this.fallbackTransportFactory();
      const response = await fallback.call(
        buildFallbackPrompt(instruction, query, reason),
        options?.signal ? { signal: options.signal } : undefined,
      );
      const text = response.content.trim();
      if (!text || /^NO_WEB_RESULTS\b/i.test(text)) return "";
      logger.info(
        {
          provider: response.provider,
          reason,
          chars: text.length,
        },
        "Web search fallback produced data",
      );
      return `[${response.provider} web-search fallback after ${reason}]\n${text}`;
    } catch (err) {
      if (isAbortError(err)) throw err;
      logger.debug({ err, reason }, "Web search fallback failed");
      return "";
    }
  }
}

export class NullWebSearchAdapter implements WebSearchPort {
  async search(
    _instruction: string,
    _query: string,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    throwIfAborted(options?.signal);
    return "";
  }
}

function createKimiWebSearchFallbackTransport(
  maxOutputTokens = 1200,
): LlmTransport {
  return new LlmChatTransport(
    {
      systemPrompt: [
        "You are a web-search fallback adapter.",
        "Use the available web-search tool; do not answer from memory.",
        "Return concise source-grounded notes with URLs when available.",
        "If no current source is available, return exactly NO_WEB_RESULTS.",
      ].join(" "),
      enableWebSearch: true,
      preferredProvider: "kimi",
      maxRetries: 1,
      overrides: {
        maxOutputTokens,
        temperature: 0.2,
      },
    },
    [new KimiProvider()],
  );
}

function buildFallbackPrompt(
  instruction: string,
  query: string,
  reason: string,
): string {
  return [
    `Primary OpenAI web search failed: ${reason}.`,
    `Search query: ${query}`,
    "",
    "Task:",
    instruction,
    "",
    "Return only the source-grounded notes. Include source URLs when the tool provides them.",
  ].join("\n");
}

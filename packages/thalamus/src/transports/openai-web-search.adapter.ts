/**
 * OpenAI Web Search adapter — implements `WebSearchPort` against the
 * OpenAI Responses API with the `web_search_preview` tool.
 *
 * Also exports `NullWebSearchAdapter` for environments without an API
 * key (returns `""`, so the executor silently skips web enrichment).
 */

import { createLogger } from "@interview/shared/observability";
import type { WebSearchPort } from "../ports/web-search.port";

const logger = createLogger("openai-web-search");

export class OpenAIWebSearchAdapter implements WebSearchPort {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async search(instruction: string, _query: string): Promise<string> {
    try {
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
      });

      if (!response.ok) {
        logger.debug({ status: response.status }, "Web search failed");
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

      return text;
    } catch (err) {
      logger.debug({ err }, "Web search fallback failed");
      return "";
    }
  }
}

export class NullWebSearchAdapter implements WebSearchPort {
  async search(_instruction: string, _query: string): Promise<string> {
    return "";
  }
}

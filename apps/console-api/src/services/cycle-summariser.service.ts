// apps/console-api/src/services/cycle-summariser.service.ts
//
// Builds the post-cycle briefing for the REPL "run_cycle" branch. Feeds
// the cycle id and the top findings (already view-shaped) to the
// summariser LLM and returns the generated text plus the provider that
// served it.
import { summariserPrompt } from "../prompts/repl-chat.prompt";
import type { ReplFindingSummaryView } from "../types/repl-chat.types";
import type { LlmTransportFactory } from "./llm-transport.port";

export class CycleSummariser {
  constructor(private readonly llm: LlmTransportFactory) {}

  async summarise(
    query: string,
    cycleId: string,
    findings: ReplFindingSummaryView[],
  ): Promise<{ text: string; provider: string }> {
    const summariser = this.llm.create(summariserPrompt(query));
    const payload = JSON.stringify({ cycleId, findings }, null, 2);
    const summary = await summariser.call(payload);
    return { text: summary.content, provider: summary.provider };
  }
}

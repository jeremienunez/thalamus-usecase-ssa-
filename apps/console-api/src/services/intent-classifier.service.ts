// apps/console-api/src/services/intent-classifier.service.ts
//
// Routes a user REPL input to either a conversational reply or a research
// cycle. Calls the classifier LLM with `CLASSIFIER_SYSTEM_PROMPT`, then
// extracts the first JSON object from the response. Any malformed output
// collapses to the safe default of `{action:"chat"}`.
import { CLASSIFIER_SYSTEM_PROMPT } from "../prompts/repl-chat.prompt";
import type { LlmTransportFactory } from "./llm-transport.port";

export type ReplIntent =
  | { action: "chat" }
  | { action: "run_cycle"; query: string };

export class IntentClassifier {
  constructor(private readonly llm: LlmTransportFactory) {}

  async classify(input: string, signal?: AbortSignal): Promise<ReplIntent> {
    const classifier = this.llm.create(CLASSIFIER_SYSTEM_PROMPT);
    const routed = signal
      ? await classifier.call(input, { signal })
      : await classifier.call(input);
    try {
      const m = routed.content.match(/\{[\s\S]*\}/);
      return m ? (JSON.parse(m[0]) as ReplIntent) : { action: "chat" };
    } catch {
      return { action: "chat" };
    }
  }
}

// apps/console-api/src/services/chat-reply.service.ts
//
// Single-turn conversational reply for the REPL "chat" branch. Wraps the
// LLM transport factory with the fixed console-chat system prompt so the
// orchestrator doesn't have to know which prompt belongs to which path.
import { CONSOLE_CHAT_SYSTEM_PROMPT } from "../prompts/repl-chat.prompt";
import type { LlmTransportFactory } from "./llm-transport.port";

export class ChatReplyService {
  constructor(private readonly llm: LlmTransportFactory) {}

  async reply(
    input: string,
    signal?: AbortSignal,
  ): Promise<{ text: string; provider: string }> {
    const chat = this.llm.create(CONSOLE_CHAT_SYSTEM_PROMPT);
    const response = signal
      ? await chat.call(input, { signal })
      : await chat.call(input);
    return { text: response.content, provider: response.provider };
  }
}

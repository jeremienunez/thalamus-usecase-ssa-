import { countTokens } from "./tokens";

export interface Turn {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCall?: { action: string; args: Record<string, unknown> };
  toolResult?: unknown;
  ts?: number;
}

export class ConversationBuffer {
  private readonly maxTokens: number;
  private readonly list: Turn[] = [];
  private tokenCache = 0;

  constructor(opts: { maxTokens: number }) {
    this.maxTokens = opts.maxTokens;
  }
  append(t: Turn): void {
    const stamped = { ...t, ts: t.ts ?? Date.now() };
    this.list.push(stamped);
    this.tokenCache += countTokens(t.content);
  }
  turns(): readonly Turn[] {
    return this.list;
  }
  totalTokens(): number {
    return this.tokenCache;
  }
  overThreshold(): boolean {
    return this.tokenCache > this.maxTokens;
  }
  replayWindow(): readonly Turn[] {
    return this.list;
  }
}

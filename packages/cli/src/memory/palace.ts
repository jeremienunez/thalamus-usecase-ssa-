import type { Turn } from "./buffer";

export interface SimMemoryRepo {
  embed(text: string): Promise<number[]>;
  insert(row: {
    scope: string;
    sessionId: string;
    content: string;
    embedding: number[];
    role: string;
    ts: number;
  }): Promise<void>;
  similaritySearch(q: {
    scope: string;
    sessionId: string;
    text: string;
    k: number;
    embedding?: number[];
  }): Promise<Array<{ content: string; score: number }>>;
}

export class MemoryPalace {
  constructor(
    private readonly repo: SimMemoryRepo,
    private readonly opts: { sessionId: string },
  ) {}
  async remember(t: Turn): Promise<void> {
    const embedding = await this.repo.embed(t.content);
    await this.repo.insert({
      scope: "cli_session",
      sessionId: this.opts.sessionId,
      content: t.content,
      embedding,
      role: t.role,
      ts: t.ts ?? Date.now(),
    });
  }
  async recall(queryText: string, k = 8): Promise<Array<{ content: string; score: number }>> {
    const embedding = await this.repo.embed(queryText);
    return this.repo.similaritySearch({
      scope: "cli_session",
      sessionId: this.opts.sessionId,
      text: queryText,
      k,
      embedding,
    });
  }
}

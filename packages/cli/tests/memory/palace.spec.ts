import { describe, it, expect, vi } from "vitest";
import { MemoryPalace } from "../../src/memory/palace";

describe("MemoryPalace", () => {
  it("writes turns with scope=cli_session", async () => {
    const repo = {
      embed: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
      insert: vi.fn().mockResolvedValue(undefined),
      similaritySearch: vi.fn().mockResolvedValue([]),
    };
    const p = new MemoryPalace(repo, { sessionId: "s1" });
    await p.remember({ role: "user", content: "hello" });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "cli_session",
        sessionId: "s1",
        content: "hello",
      }),
    );
  });
  it("recall delegates to similaritySearch with sessionId filter", async () => {
    const repo = {
      embed: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
      insert: vi.fn(),
      similaritySearch: vi.fn().mockResolvedValue([
        { content: "earlier turn", score: 0.9 },
      ]),
    };
    const p = new MemoryPalace(repo, { sessionId: "s1" });
    const r = await p.recall("query text", 5);
    expect(repo.similaritySearch).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "cli_session",
        sessionId: "s1",
        k: 5,
      }),
    );
    expect(r).toEqual([{ content: "earlier turn", score: 0.9 }]);
  });
});

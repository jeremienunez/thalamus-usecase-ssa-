import { describe, it, expect } from "vitest";
import { ConversationBuffer } from "../../src/memory/buffer";

describe("ConversationBuffer", () => {
  it("appends and returns turns in order", () => {
    const b = new ConversationBuffer({ maxTokens: 10_000 });
    b.append({ role: "user", content: "hi" });
    b.append({ role: "assistant", content: "hello" });
    expect(b.turns()).toHaveLength(2);
  });
  it("reports totalTokens", () => {
    const b = new ConversationBuffer({ maxTokens: 10_000 });
    b.append({ role: "user", content: "hello world" });
    expect(b.totalTokens()).toBeGreaterThan(0);
  });
  it("overThreshold true once totalTokens > maxTokens", () => {
    const b = new ConversationBuffer({ maxTokens: 1 });
    b.append({ role: "user", content: "hello world, this is long" });
    expect(b.overThreshold()).toBe(true);
  });
});

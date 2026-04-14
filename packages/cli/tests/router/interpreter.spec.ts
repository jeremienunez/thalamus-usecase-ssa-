import { describe, it, expect, vi } from "vitest";
import { interpret } from "../../src/router/interpreter";

const fakeNano = (response: unknown) => ({
  call: vi.fn().mockResolvedValue({ content: JSON.stringify(response), costUsd: 0.001 }),
});

describe("interpret()", () => {
  it("parses a well-formed router plan", async () => {
    const nano = fakeNano({ steps: [{ action: "query", q: "hello" }], confidence: 0.9 });
    const r = await interpret({ input: "hello world", recentTurns: [], availableEntityIds: [] }, nano);
    expect(r.plan.steps[0]).toMatchObject({ action: "query", q: "hello" });
    expect(r.costUsd).toBe(0.001);
  });

  it("throws on malformed JSON", async () => {
    const nano = { call: vi.fn().mockResolvedValue({ content: "not json", costUsd: 0 }) };
    await expect(
      interpret({ input: "x", recentTurns: [], availableEntityIds: [] }, nano),
    ).rejects.toThrow();
  });

  it("throws on schema violation", async () => {
    const nano = fakeNano({ steps: [], confidence: 0.9 });
    await expect(
      interpret({ input: "x", recentTurns: [], availableEntityIds: [] }, nano),
    ).rejects.toThrow();
  });
});

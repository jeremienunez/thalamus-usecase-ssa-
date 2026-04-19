import { describe, it, expect, vi } from "vitest";
import { createSweepApi } from "./sweep";

describe("createSweepApi", () => {
  it("listSuggestions + review", async () => {
    const calls: unknown[][] = [];
    const api = createSweepApi({
      getJson: vi.fn(async (p: string) => {
        calls.push(["GET", p]);
        return { items: [], count: 0 } as never;
      }),
      postJson: vi.fn(async (p: string, b: unknown) => {
        calls.push(["POST", p, b]);
        return { ok: true, reviewed: true, resolution: null } as never;
      }),
    });
    await api.listSuggestions();
    await api.review("s/1", true, "looks good");
    expect(calls).toEqual([
      ["GET", "/api/sweep/suggestions"],
      ["POST", "/api/sweep/suggestions/s%2F1/review", { accept: true, reason: "looks good" }],
    ]);
  });
});

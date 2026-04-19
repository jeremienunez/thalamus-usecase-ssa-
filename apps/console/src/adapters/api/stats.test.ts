import { describe, it, expect, vi } from "vitest";
import { createStatsApi } from "./stats";

describe("createStatsApi", () => {
  it("get() hits /api/stats", async () => {
    const paths: string[] = [];
    const api = createStatsApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return {} as never;
      }),
      postJson: vi.fn(),
    });
    await api.get();
    expect(paths).toEqual(["/api/stats"]);
  });
});

import { describe, it, expect, vi } from "vitest";
import { createStatsApi } from "./stats";
import { EMPTY_STATS } from "../../../tests/wrap";

describe("createStatsApi", () => {
  it("get() hits /api/stats", async () => {
    const paths: string[] = [];
    const api = createStatsApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return EMPTY_STATS;
      }),
      postJson: vi.fn(),
    });
    await api.get();
    expect(paths).toEqual(["/api/stats"]);
  });
});

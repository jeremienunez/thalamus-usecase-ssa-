import { describe, it, expect, vi } from "vitest";
import { createMissionApi } from "./mission";

describe("createMissionApi", () => {
  it("status + start + stop", async () => {
    const calls: unknown[][] = [];
    const api = createMissionApi({
      getJson: vi.fn(async (p: string) => {
        calls.push(["GET", p]);
        return {} as never;
      }),
      postJson: vi.fn(async (p: string, b: unknown) => {
        calls.push(["POST", p, b]);
        return {} as never;
      }),
    });
    await api.status();
    await api.start();
    await api.stop();
    expect(calls).toEqual([
      ["GET", "/api/sweep/mission/status"],
      ["POST", "/api/sweep/mission/start", undefined],
      ["POST", "/api/sweep/mission/stop", undefined],
    ]);
  });
});

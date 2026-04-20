import { describe, it, expect, vi } from "vitest";
import { createAutonomyApi } from "./autonomy";

describe("createAutonomyApi", () => {
  it("status + start + stop + reset with optional intervalSec", async () => {
    const calls: unknown[][] = [];
    const api = createAutonomyApi({
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
    await api.start(30);
    await api.start(undefined);
    await api.stop();
    await api.reset();
    expect(calls).toEqual([
      ["GET", "/api/autonomy/status"],
      ["POST", "/api/autonomy/start", { intervalSec: 30 }],
      ["POST", "/api/autonomy/start", {}],
      ["POST", "/api/autonomy/stop", undefined],
      ["POST", "/api/autonomy/reset", undefined],
    ]);
  });
});

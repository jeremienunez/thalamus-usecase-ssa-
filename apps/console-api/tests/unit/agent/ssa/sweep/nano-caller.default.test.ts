import { describe, it, expect, vi, beforeEach } from "vitest";
import { callNanoWaves } from "@interview/thalamus";
import { defaultNanoCaller } from "../../../../../src/agent/ssa/sweep/nano-caller.default";

vi.mock("@interview/thalamus", () => ({
  callNanoWaves: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("defaultNanoCaller.callWaves", () => {
  it("forwards items and buildRequest directly to callNanoWaves", async () => {
    const buildRequest = vi.fn();
    vi.mocked(callNanoWaves).mockResolvedValueOnce([
      {
        ok: true,
        text: "[]",
        urls: [],
        latencyMs: 12,
        index: 0,
      },
    ]);

    const result = await defaultNanoCaller.callWaves(
      [{ operatorCountries: [] }],
      buildRequest,
    );

    expect(callNanoWaves).toHaveBeenCalledTimes(1);
    expect(callNanoWaves).toHaveBeenCalledWith(
      [{ operatorCountries: [] }],
      buildRequest,
    );
    expect(result[0]?.ok).toBe(true);
  });
});

import { describe, it, expect, vi } from "vitest";
import { runCycleAdapter } from "../../src/adapters/thalamus";

describe("runCycleAdapter", () => {
  it("forwards args to svc.runCycle and returns result", async () => {
    const result = { findings: [{ id: "f1" }], costUsd: 0.12 };
    const svc = { runCycle: vi.fn().mockResolvedValue(result) };
    const r = await runCycleAdapter(svc, { query: "q", cycleId: "c1" });
    expect(svc.runCycle).toHaveBeenCalledWith({ query: "q", cycleId: "c1" });
    expect(r).toBe(result);
  });
});

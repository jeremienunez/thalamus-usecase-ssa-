import { describe, it, expect, vi } from "vitest";
import { startTelemetryAdapter } from "../../src/adapters/telemetry";

describe("startTelemetryAdapter", () => {
  it("renames satId to satelliteId when calling service", async () => {
    const svc = { start: vi.fn().mockResolvedValue({ distribution: { rng: 1 } }) };
    const r = await startTelemetryAdapter(svc, { satId: "SAT-42" });
    expect(svc.start).toHaveBeenCalledWith({ satelliteId: "SAT-42" });
    expect(r).toEqual({ distribution: { rng: 1 } });
  });
});

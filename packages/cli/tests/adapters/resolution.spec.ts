import { describe, it, expect, vi } from "vitest";
import { acceptAdapter } from "../../src/adapters/resolution";

describe("acceptAdapter", () => {
  it("passes source=cli and actorId=cli:local through to resolve", async () => {
    const svc = { resolve: vi.fn().mockResolvedValue({ ok: true, delta: { n: 1 } }) };
    const r = await acceptAdapter(svc, { suggestionId: "s-99" });
    expect(svc.resolve).toHaveBeenCalledWith({
      suggestionId: "s-99",
      actorId: "cli:local",
      source: "cli",
    });
    expect(r).toEqual({ ok: true, delta: { n: 1 } });
  });
});

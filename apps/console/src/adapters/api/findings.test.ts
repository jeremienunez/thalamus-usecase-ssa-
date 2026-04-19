import { describe, it, expect, vi } from "vitest";
import { createFindingsApi } from "./findings";

describe("createFindingsApi", () => {
  it("list() builds query from filter args", async () => {
    const paths: string[] = [];
    const api = createFindingsApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return { items: [], count: 0 };
      }),
      postJson: vi.fn(),
    });
    await api.list();
    await api.list({ status: "pending" });
    await api.list({ status: "accepted", cortex: "orbit-slot-optimizer" });
    expect(paths).toEqual([
      "/api/findings",
      "/api/findings?status=pending",
      "/api/findings?status=accepted&cortex=orbit-slot-optimizer",
    ]);
  });

  it("findById encodes id", async () => {
    const paths: string[] = [];
    const api = createFindingsApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return {} as never;
      }),
      postJson: vi.fn(),
    });
    await api.findById("foo/bar");
    expect(paths).toEqual(["/api/findings/foo%2Fbar"]);
  });

  it("decide posts JSON", async () => {
    const calls: Array<[string, unknown]> = [];
    const api = createFindingsApi({
      getJson: vi.fn(),
      postJson: vi.fn(async (p: string, b: unknown) => {
        calls.push([p, b]);
        return { ok: true } as never;
      }),
    });
    await api.decide("f1", "accepted", "ok");
    expect(calls).toEqual([
      ["/api/findings/f1/decision", { decision: "accepted", reason: "ok" }],
    ]);
  });
});

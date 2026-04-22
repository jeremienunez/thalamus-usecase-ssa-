import { describe, it, expect, vi } from "vitest";
import { createCyclesApi } from "./cycles";
import { EMPTY_CYCLE } from "../../../tests/wrap";

describe("createCyclesApi", () => {
  it("list hits /api/cycles; run posts /api/cycles/run", async () => {
    const calls: Array<[string, "GET" | "POST", unknown?]> = [];
    const api = createCyclesApi({
      getJson: vi.fn(async (p: string) => {
        calls.push([p, "GET"]);
        return { items: [] };
      }),
      postJson: vi.fn(async (p: string, b: unknown) => {
        calls.push([p, "POST", b]);
        return { cycle: EMPTY_CYCLE };
      }),
    });
    await api.list();
    await api.run("thalamus");
    expect(calls).toEqual([
      ["/api/cycles", "GET"],
      ["/api/cycles/run", "POST", { kind: "thalamus" }],
    ]);
  });
});

import { describe, it, expect, vi } from "vitest";
import { createKgApi } from "./kg";

describe("createKgApi", () => {
  it("listNodes + listEdges hit the right paths", async () => {
    const paths: string[] = [];
    const api = createKgApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return { items: [] };
      }),
      postJson: vi.fn(),
    });
    await api.listNodes();
    await api.listEdges();
    expect(paths).toEqual(["/api/kg/nodes", "/api/kg/edges"]);
  });
});

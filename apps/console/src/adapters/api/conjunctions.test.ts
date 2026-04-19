import { describe, it, expect, vi } from "vitest";
import { createConjunctionsApi } from "./conjunctions";

describe("createConjunctionsApi", () => {
  it("list() encodes minPc", async () => {
    const paths: string[] = [];
    const api = createConjunctionsApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return { items: [], count: 0 };
      }),
      postJson: vi.fn(),
    });
    await api.list(1e-8);
    expect(paths).toEqual(["/api/conjunctions?minPc=1e-8"]);
  });

  it("list() defaults minPc to 0", async () => {
    const paths: string[] = [];
    const api = createConjunctionsApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return { items: [], count: 0 };
      }),
      postJson: vi.fn(),
    });
    await api.list();
    expect(paths).toEqual(["/api/conjunctions?minPc=0"]);
  });
});

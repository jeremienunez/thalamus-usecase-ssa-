import { describe, it, expect, vi } from "vitest";
import { neighbourhoodAdapter } from "../../src/adapters/graph";

describe("neighbourhoodAdapter", () => {
  it("BFS to depth 2 returns tree shape", async () => {
    const edges: Record<string, Array<{ from: string; to: string; kind: string }>> = {
      A: [
        { from: "A", to: "B", kind: "rel" },
        { from: "A", to: "C", kind: "rel" },
      ],
      B: [{ from: "B", to: "D", kind: "rel" }],
      C: [{ from: "C", to: "E", kind: "rel" }],
      D: [],
      E: [],
    };
    const repo = { edges: vi.fn(async (e: string) => edges[e] ?? []) };
    const tree = await neighbourhoodAdapter(repo, { entity: "A", maxDepth: 2 });
    expect(tree.root).toBe("A");
    expect(tree.levels[0]).toEqual({ depth: 0, nodes: ["A"] });
    expect(tree.levels[1].nodes.sort()).toEqual(["B", "C"]);
    expect(tree.levels[2].nodes.sort()).toEqual(["D", "E"]);
  });

  it("respects cap", async () => {
    const repo = {
      edges: vi.fn(async (e: string) => [
        { from: e, to: `${e}x`, kind: "rel" },
        { from: e, to: `${e}y`, kind: "rel" },
        { from: e, to: `${e}z`, kind: "rel" },
      ]),
    };
    const tree = await neighbourhoodAdapter(repo, { entity: "A", maxDepth: 3, cap: 3 });
    const total = tree.levels.reduce((n, l) => n + l.nodes.length, 0);
    expect(total).toBeLessThanOrEqual(3);
  });
});

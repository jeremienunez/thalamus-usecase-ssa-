import { describe, it, expect, vi } from "vitest";
import { buildWhyTree } from "../../src/adapters/why";

describe("buildWhyTree", () => {
  it("returns null when finding not found", async () => {
    const repo = {
      finding: vi.fn().mockResolvedValue(null),
      incomingEdges: vi.fn(),
      sourceItem: vi.fn(),
    };
    const r = await buildWhyTree(repo, { findingId: "missing" });
    expect(r).toBeNull();
  });

  it("builds finding -> edge -> source_item tree", async () => {
    const repo = {
      finding: vi.fn().mockResolvedValue({ id: "f1", label: "Finding 1" }),
      incomingEdges: vi.fn().mockResolvedValue([
        {
          kind: "derived_from",
          from: "src1",
          fromKind: "source_item",
          label: "edge-label",
          sha256: "abc",
        },
      ]),
      sourceItem: vi.fn().mockResolvedValue({ id: "src1", label: "Doc A", sha256: "def" }),
    };
    const tree = await buildWhyTree(repo, { findingId: "f1" });
    expect(tree).not.toBeNull();
    expect(tree!.kind).toBe("finding");
    expect(tree!.id).toBe("f1");
    expect(tree!.children).toHaveLength(1);
    const edge = tree!.children[0];
    expect(edge.kind).toBe("edge");
    expect(edge.sha256).toBe("abc");
    expect(edge.children).toHaveLength(1);
    expect(edge.children[0]).toEqual({
      id: "src1",
      label: "Doc A",
      kind: "source_item",
      sha256: "def",
      children: [],
    });
  });
});

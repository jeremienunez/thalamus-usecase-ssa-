/**
 * EmbedderPort + NullEmbedder — Phase 4 · Task 4.1 of thalamus
 * agnosticity cleanup.
 *
 * The kernel ships an `EmbedderPort` interface plus a `NullEmbedder`
 * default used when no domain adapter is injected. These tests pin the
 * default's behaviour so downstream consumers (ResearchGraphService,
 * container.ts) can rely on "no embedding available → graceful no-op"
 * without a live Voyage adapter.
 */
import { describe, it, expect } from "vitest";
import { NullEmbedder } from "../src/entities/null-embedder";
import type { EmbedderPort } from "../src/ports/embedder.port";

export function embedderPortContract(
  name: string,
  build: () => EmbedderPort,
): void {
  describe(`EmbedderPort contract — ${name}`, () => {
    it("isAvailable returns a boolean", () => {
      expect(typeof build().isAvailable()).toBe("boolean");
    });

    it("embedQuery resolves to either a vector or null", async () => {
      const result = await build().embedQuery("");
      expect(result === null || Array.isArray(result)).toBe(true);
    });

    it("embedDocuments preserves input length", async () => {
      const out = await build().embedDocuments(["a", "b", "c"]);
      expect(out).toHaveLength(3);
    });

    it("embedDocuments returns an empty array for an empty input", async () => {
      expect(await build().embedDocuments([])).toEqual([]);
    });
  });
}

embedderPortContract("NullEmbedder", () => new NullEmbedder());

describe("NullEmbedder", () => {
  it("reports unavailable so callers skip the semantic path", () => {
    expect(new NullEmbedder().isAvailable()).toBe(false);
  });

  it("embedQuery returns null", async () => {
    expect(await new NullEmbedder().embedQuery("anything")).toBeNull();
  });

  it("embedDocuments returns one null per input, preserving length", async () => {
    const out = await new NullEmbedder().embedDocuments(["a", "b", "c"]);
    expect(out).toEqual([null, null, null]);
    expect(out).toHaveLength(3);
  });
});

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

describe("NullEmbedder", () => {
  it("reports unavailable so callers skip the semantic path", () => {
    const embedder: EmbedderPort = new NullEmbedder();
    expect(embedder.isAvailable()).toBe(false);
  });

  it("embedQuery returns null", async () => {
    const embedder: EmbedderPort = new NullEmbedder();
    expect(await embedder.embedQuery("anything")).toBeNull();
  });

  it("embedDocuments returns one null per input, preserving length", async () => {
    const embedder: EmbedderPort = new NullEmbedder();
    const out = await embedder.embedDocuments(["a", "b", "c"]);
    expect(out).toEqual([null, null, null]);
    expect(out).toHaveLength(3);
  });

  it("embedDocuments returns an empty array for an empty input", async () => {
    const embedder: EmbedderPort = new NullEmbedder();
    expect(await embedder.embedDocuments([])).toEqual([]);
  });
});

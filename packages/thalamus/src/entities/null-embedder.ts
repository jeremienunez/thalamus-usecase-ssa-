import type { EmbedderPort } from "../ports/embedder.port";

/**
 * Default `EmbedderPort` for kernel builds without a domain adapter.
 *
 * `isAvailable()` reports `false`, `embedQuery` returns `null`, and
 * `embedDocuments` returns an array of `null`s — `ResearchGraphService`
 * then skips semantic dedup + cross-linking and stores findings with
 * `embedding: null`. Apps ship a real adapter (e.g.
 * `SsaVoyageEmbedderAdapter`) at their composition root.
 */
export class NullEmbedder implements EmbedderPort {
  isAvailable(): boolean {
    return false;
  }

  async embedQuery(_text: string): Promise<number[] | null> {
    return null;
  }

  async embedDocuments(texts: string[]): Promise<(number[] | null)[]> {
    return texts.map((): number[] | null => null);
  }
}

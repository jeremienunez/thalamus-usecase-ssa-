/**
 * EmbedderPort — domain-owned text embedding adapter.
 *
 * `ResearchGraphService` calls this port to compute query + document
 * embeddings used by semantic dedup (cosine ≥ 0.92 merge), cross-linking
 * (0.7–0.92), and `/api/research/semantic-search`. The kernel stays
 * ignorant of which provider (Voyage, OpenAI, local model) generates the
 * vectors — apps ship the concrete adapter at their composition root.
 *
 * Contract:
 * - `isAvailable()` reports whether the adapter can embed (e.g. API key
 *   configured). When `false`, `embedQuery` returns `null` and
 *   `embedDocuments` returns an array of `null`s matching the input
 *   length. Callers already treat `null` as "no embedding, skip the
 *   semantic path" — kernel behaviour is identical with or without an
 *   embedder.
 * - Vector dimension must match the DB schema's `EMBEDDING_DIMENSIONS`
 *   before kernel semantic paths or persistence writes use it. `null`
 *   remains the graceful no-op signal for unavailable embeddings.
 */

export interface EmbedderPort {
  /** `true` when the adapter can produce real embeddings. */
  isAvailable(): boolean;

  /**
   * Embed a single query string (e.g. a finding title + summary, a
   * satellite name). Returns `null` on transport error or when the
   * adapter is unavailable — callers fall through to non-semantic paths.
   */
  embedQuery(text: string): Promise<number[] | null>;

  /**
   * Embed a batch of documents for bulk storage. Returns an array of
   * the same length as `texts`; individual entries are `null` on
   * per-item failure. Adapters are free to internally batch API calls.
   */
  embedDocuments(texts: string[]): Promise<(number[] | null)[]>;
}

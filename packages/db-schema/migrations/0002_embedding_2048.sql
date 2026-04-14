-- Upgrade embedding column to voyage-4 2048-dim (Matryoshka).
--
-- pgvector HNSW caps at 2000 dims for full `vector`. Switch to `halfvec`
-- (float16) which supports HNSW up to 4000 dims at half the storage, with
-- within-noise recall for cosine similarity on language-model embeddings.
--
-- Existing 1024-dim values are cleared (the embedding column is a cache —
-- `ResearchGraphService.storeFinding` re-computes on next call).

DROP INDEX IF EXISTS idx_research_finding_embedding_hnsw;

UPDATE research_finding SET embedding = NULL WHERE embedding IS NOT NULL;

ALTER TABLE research_finding
  ALTER COLUMN embedding TYPE halfvec(2048)
  USING NULL;

CREATE INDEX IF NOT EXISTS idx_research_finding_embedding_hnsw
  ON research_finding
  USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

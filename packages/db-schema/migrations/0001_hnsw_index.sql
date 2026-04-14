-- HNSW index on research_finding.embedding.
-- drizzle-kit emits a B-tree by default — HNSW must be applied manually.
-- Applied AFTER the main `drizzle-kit push` / initial migration so the
-- table + column exist.

CREATE INDEX IF NOT EXISTS idx_research_finding_embedding_hnsw
  ON research_finding
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

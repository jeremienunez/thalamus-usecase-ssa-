-- HNSW index on sim_agent_memory.embedding for per-fish vector retrieval.
-- Mirrors migrations/0001_hnsw_index.sql for research_finding.
-- Drizzle-kit emits B-tree by default; HNSW is applied manually post-generate.

CREATE INDEX IF NOT EXISTS idx_sim_agent_memory_embedding_hnsw
  ON sim_agent_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

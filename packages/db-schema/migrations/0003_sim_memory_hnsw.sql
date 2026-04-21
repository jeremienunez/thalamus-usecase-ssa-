-- HNSW index on sim_agent_memory.embedding for per-fish vector retrieval.
-- Like research_finding, the post-drizzle phase sees the final schema state,
-- so the column may already be `halfvec(2048)` on a fresh database.

DO $$
DECLARE
  embedding_type text;
  opclass text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO embedding_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'sim_agent_memory'
    AND a.attname = 'embedding'
    AND NOT a.attisdropped;

  IF embedding_type IS NULL THEN
    RAISE NOTICE 'sim_agent_memory.embedding not found, skipping HNSW index';
    RETURN;
  END IF;

  opclass := CASE
    WHEN embedding_type LIKE 'halfvec%' THEN 'halfvec_cosine_ops'
    ELSE 'vector_cosine_ops'
  END;

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_sim_agent_memory_embedding_hnsw ON sim_agent_memory USING hnsw (embedding %s) WITH (m = 16, ef_construction = 64)',
    opclass
  );
END $$;

-- HNSW index on research_finding.embedding.
-- The raw SQL phase runs after the full drizzle journal, so on a fresh database
-- the column may already be `halfvec(2048)` rather than the historical
-- `vector(1024)`. Pick the matching pgvector opclass dynamically.

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
    AND c.relname = 'research_finding'
    AND a.attname = 'embedding'
    AND NOT a.attisdropped;

  IF embedding_type IS NULL THEN
    RAISE NOTICE 'research_finding.embedding not found, skipping HNSW index';
    RETURN;
  END IF;

  opclass := CASE
    WHEN embedding_type LIKE 'halfvec%' THEN 'halfvec_cosine_ops'
    ELSE 'vector_cosine_ops'
  END;

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_research_finding_embedding_hnsw ON research_finding USING hnsw (embedding %s) WITH (m = 16, ef_construction = 64)',
    opclass
  );
END $$;

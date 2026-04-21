-- Catalog embeddings for KNN enrichment / conjunction candidate queries.
--
-- These columns are exercised by the console-api repositories and seed scripts
-- (`embed-catalog.ts`, KNN propagation). Fresh CI databases must provision
-- them, otherwise routes work only against drifted local databases.

ALTER TABLE satellite
  ADD COLUMN IF NOT EXISTS embedding halfvec(2048);

ALTER TABLE satellite
  ADD COLUMN IF NOT EXISTS embedding_model text;

ALTER TABLE satellite
  ADD COLUMN IF NOT EXISTS embedded_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS satellite_embedding_hnsw
ON satellite
USING hnsw (embedding halfvec_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS satellite_class_regime_idx
ON satellite ((metadata->>'apogeeKm'), object_class)
WHERE embedding IS NOT NULL;

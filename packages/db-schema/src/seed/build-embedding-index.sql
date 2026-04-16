-- HNSW cosine index on satellite.embedding.
-- Built AFTER the embed pass so we don't pay the incremental-insert cost
-- on 33k rows. m=16 / ef_construction=64 are the pgvector defaults for
-- catalog-scale (<100k) with balanced recall/build time.
--
-- Query-time ef is set per session: SET hnsw.ef_search = 100;

CREATE INDEX IF NOT EXISTS satellite_embedding_hnsw
ON satellite
USING hnsw (embedding halfvec_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Fast filter for "object_class + regime" KNN queries.
CREATE INDEX IF NOT EXISTS satellite_class_regime_idx
ON satellite ((metadata->>'apogeeKm'), object_class)
WHERE embedding IS NOT NULL;

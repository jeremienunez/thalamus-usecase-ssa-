-- fn_conjunction_candidates_knn — pgvector HNSW KNN + altitude-overlap filter.
--
-- Wraps the CTE that lived in
-- apps/console-api/src/repositories/conjunction.repository.ts:findKnnCandidates.
-- The repo's previous pattern issued `SET hnsw.ef_search = N` against the
-- pool connection before the query. That leaked the setting onto the next
-- query using the same pooled connection.
--
-- Here, set_config('hnsw.ef_search', ..., true) sets it transaction-locally
-- (second arg = is_local), so the recall knob cannot leak. Callers don't have
-- to remember to SET before calling.
--
-- PL/pgSQL is required because `SET` / set_config are not legal in plain SQL
-- function bodies.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/db-schema/migrations/0013_conjunction_knn_fn.sql

CREATE OR REPLACE FUNCTION fn_conjunction_candidates_knn(
  p_target_norad_id     int,
  p_knn_k               int     DEFAULT 200,
  p_limit               int     DEFAULT 50,
  p_margin_km           real    DEFAULT 20,
  p_object_class        text    DEFAULT NULL,
  p_exclude_same_family boolean DEFAULT false,
  p_ef_search           int     DEFAULT 100
)
RETURNS TABLE (
  target_norad_id    int,
  target_name        text,
  candidate_id       int,
  candidate_name     text,
  candidate_norad_id int,
  candidate_class    text,
  cos_distance       float,
  apogee_km          float,
  perigee_km         float,
  inclination_deg    float,
  overlap_km         float,
  regime             text
)
LANGUAGE plpgsql AS $$
DECLARE
  v_ef int := GREATEST(10, LEAST(1000, p_ef_search));
BEGIN
  PERFORM set_config('hnsw.ef_search', v_ef::text, true);

  RETURN QUERY
  WITH target AS (
    SELECT
      s.id,
      s.name,
      s.norad_id,
      s.embedding,
      (s.metadata->>'apogeeKm')::numeric::float  AS apogee,
      (s.metadata->>'perigeeKm')::numeric::float AS perigee
    FROM satellite s
    WHERE s.norad_id = p_target_norad_id
      AND s.embedding IS NOT NULL
    LIMIT 1
  ),
  knn AS (
    SELECT
      s.id,
      s.name,
      s.norad_id,
      s.object_class,
      (s.metadata->>'apogeeKm')::numeric::float        AS apogee,
      (s.metadata->>'perigeeKm')::numeric::float       AS perigee,
      (s.metadata->>'inclinationDeg')::numeric::float  AS inc,
      (s.embedding <=> t.embedding)::float             AS cos_distance
    FROM satellite s, target t
    WHERE s.id != t.id
      AND s.embedding IS NOT NULL
      AND (p_object_class IS NULL OR s.object_class = p_object_class)
    ORDER BY s.embedding <=> t.embedding
    LIMIT p_knn_k
  )
  SELECT
    t.norad_id::int,
    t.name,
    k.id::int,
    k.name,
    k.norad_id::int,
    k.object_class,
    k.cos_distance,
    k.apogee,
    k.perigee,
    k.inc,
    (LEAST(t.apogee, k.apogee) - GREATEST(t.perigee, k.perigee) + 2 * p_margin_km)::float,
    CASE
      WHEN (k.apogee + k.perigee) / 2 < 2000  THEN 'leo'
      WHEN (k.apogee + k.perigee) / 2 < 35000 THEN 'meo'
      WHEN (k.apogee + k.perigee) / 2 < 36500 THEN 'geo'
      WHEN k.apogee IS NOT NULL               THEN 'heo'
      ELSE 'unknown'
    END
  FROM knn k, target t
  WHERE k.apogee IS NOT NULL
    AND k.perigee IS NOT NULL
    AND t.apogee IS NOT NULL
    AND t.perigee IS NOT NULL
    AND (LEAST(t.apogee, k.apogee) - GREATEST(t.perigee, k.perigee) + 2 * p_margin_km) > 0
    AND NOT (
      p_exclude_same_family
      AND split_part(t.name, ' ', 1) = split_part(k.name, ' ', 1)
      AND t.name ~ '[A-Z]+-?[0-9]+$'
    )
  ORDER BY k.cos_distance ASC
  LIMIT p_limit;
END;
$$;

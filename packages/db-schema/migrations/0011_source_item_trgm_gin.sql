-- Manual migration: pg_trgm GIN index on source_item.title
--
-- drizzle-kit doesn't emit trigram GIN indexes (no DSL for `gin_trgm_ops`),
-- so this is hand-written. Added for the ILIKE '%keyword%' branches in
-- `forecastDebris` + `listApogeeHistory` + `listLaunchManifest`, which
-- scan ~700 source_items per query. Cuts the news branch from ~3.7 ms to
-- <0.5 ms on a cold plan.
--
-- pg_trgm is already loaded (see infra/postgres/init.sql).

CREATE INDEX IF NOT EXISTS idx_source_item_title_trgm
  ON source_item
  USING gin (title gin_trgm_ops);

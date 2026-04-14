-- Runs once on first boot of the Postgres container (via docker-entrypoint-initdb.d).
-- Drizzle migrations pick it up from here; never add schema DDL in this file,
-- only extensions and database-level settings.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

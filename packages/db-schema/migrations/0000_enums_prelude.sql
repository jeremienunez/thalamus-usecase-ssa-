-- Enum prelude.
--
-- drizzle-kit 0.21 does not emit `CREATE TYPE` for pgEnums whose values are
-- computed at runtime (via `Object.values(tsEnum)`). Values are re-declared
-- here as literal DDL so the tables migration can reference them.
--
-- Keep in sync with:
--   packages/shared/src/enum/research.enum.ts
--   packages/db-schema/src/enums/sweep.enum.ts
--
-- Apply BEFORE 0000_flawless_dorian_gray.sql.

DO $$ BEGIN
  CREATE TYPE "cortex" AS ENUM (
    'catalog','observations','conjunction_analysis','correlation','maneuver_planning',
    'apogee_tracker','debris_forecaster','regime_profiler','fleet_analyst','launch_scout',
    'advisory_radar','payload_profiler','briefing_producer','traffic_spotter',
    'orbit_slot_optimizer','replacement_cost_analyst','mission_copywriter','orbital_analyst',
    'data_auditor','classification_auditor','strategist'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "finding_type" AS ENUM (
    'anomaly','trend','forecast','insight','alert','opportunity','strategy'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "finding_status" AS ENUM ('active','archived','invalidated');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "urgency" AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "entity_type" AS ENUM (
    'satellite','operator_country','operator','launch','satellite_bus','payload',
    'orbit_regime','conjunction_event','maneuver','finding'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "relation" AS ENUM (
    'about','compares','caused_by','affects','supports','contradicts','similar_to'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "cycle_trigger" AS ENUM ('daemon','user','alert','system');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "cycle_status" AS ENUM ('running','completed','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "sweep_category" AS ENUM (
    'mass_anomaly','missing_data','doctrine_mismatch','relationship_error','enrichment','briefing_angle'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "sweep_severity" AS ENUM ('critical','warning','info');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "sweep_resolution_status" AS ENUM ('success','partial','failed','pending_selection');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "source_kind" AS ENUM (
    'rss','arxiv','ntrs','osint','field','radar','press'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Orbital-analytics SQL functions.
--
-- Makes four previously-silent helper parameters first-class:
--   1. fn_plan_orbit_slots        — drops horizonYears (no SQL meaning today)
--   2. fn_analyze_orbital_traffic — wires regimeId into density branch
--   3. fn_forecast_debris         — wires regimeId into density+fragmentation;
--                                   drops horizonYears
--   4. fn_list_launch_manifest    — drops regimeId (no branch has structured
--                                   regime linkage); horizonDays already works
--
-- Each UNION-ALL function returns a `branch_filter_applied boolean` column so
-- callers can see per-row whether the regime filter actually narrowed the
-- result (true) or the row came through a free-text / global branch that
-- cannot filter by regime (false). This makes the HTTP contract honest
-- rather than just pushing the silent drop down one layer.
--
-- Apply manually on a migrated DB:
--   psql "$DATABASE_URL" -f packages/db-schema/migrations/0012_orbital_analytics_fns.sql
--
-- drizzle-kit push does NOT pick this file up (functions are not inferred
-- from the schema barrel). Mirrors the pattern used for 0001_hnsw_index.sql
-- and 0011_source_item_trgm_gin.sql.

ALTER TABLE orbit_regime
  ADD COLUMN IF NOT EXISTS baselines jsonb;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. fn_plan_orbit_slots
-- ─────────────────────────────────────────────────────────────────────────
-- horizonYears was accepted by the TS signature but never reached the SQL.
-- Projecting forward by N years would need a per-satellite nominal-life
-- model (safe_mission_window UDF — not present in this DB). Until that
-- lands, the parameter is removed from the contract.

CREATE OR REPLACE FUNCTION fn_plan_orbit_slots(
  p_operator_id bigint DEFAULT NULL,
  p_limit       int    DEFAULT 20
)
RETURNS TABLE (
  regime_id              int,
  regime_name            text,
  operator_id            int,
  operator_name          text,
  satellites_in_regime   int,
  share_of_regime_pct    real
)
LANGUAGE sql STABLE AS $$
  WITH regime_totals AS (
    SELECT oc.orbit_regime_id AS rid, count(s.id)::int AS total
    FROM satellite s
    JOIN operator_country oc ON oc.id = s.operator_country_id
    WHERE oc.orbit_regime_id IS NOT NULL
    GROUP BY oc.orbit_regime_id
  )
  SELECT
    orr.id::int,
    orr.name,
    op.id::int,
    op.name,
    count(s.id)::int,
    (count(s.id) * 100.0 / NULLIF(rt.total, 0))::real
  FROM satellite s
  JOIN operator_country oc  ON oc.id = s.operator_country_id
  JOIN orbit_regime orr     ON orr.id = oc.orbit_regime_id
  LEFT JOIN operator op     ON op.id = s.operator_id
  JOIN regime_totals rt     ON rt.rid = orr.id
  WHERE (p_operator_id IS NULL OR op.id = p_operator_id)
  GROUP BY orr.id, orr.name, op.id, op.name, rt.total
  ORDER BY (count(s.id) * 100.0 / NULLIF(rt.total, 0)) DESC NULLS LAST
  LIMIT p_limit;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. fn_analyze_orbital_traffic
-- ─────────────────────────────────────────────────────────────────────────
-- regimeId applies only to the `density` branch. The `news` branch is
-- free-text over source_item titles and cannot be structurally filtered
-- by regime; branch_filter_applied = false for every news row.

CREATE OR REPLACE FUNCTION fn_analyze_orbital_traffic(
  p_window_days int    DEFAULT 30,
  p_regime_id   bigint DEFAULT NULL,
  p_limit       int    DEFAULT 30
)
RETURNS TABLE (
  kind                  text,
  regime_name           text,
  satellite_count       int,
  title                 text,
  url                   text,
  published_at          text,
  baselines             jsonb,
  branch_filter_applied boolean
)
LANGUAGE sql STABLE AS $$
  (
    SELECT
      'density'::text,
      orr.name,
      (SELECT count(*)::int FROM satellite s2
         WHERE lower(s2.telemetry_summary->>'regime') = bd.slug),
      NULL::text,
      NULL::text,
      NULL::text,
      orr.baselines,
      (p_regime_id IS NOT NULL)
    FROM (VALUES
      ('leo', 'Low Earth Orbit'),
      ('meo', 'Medium Earth Orbit'),
      ('geo', 'Geostationary Orbit'),
      ('heo', 'Highly Elliptical Orbit'),
      ('sso', 'Sun-Synchronous Orbit'),
      ('gto', 'Geostationary Transfer Orbit')
    ) AS bd(slug, long_name)
    JOIN orbit_regime orr ON orr.name = bd.long_name
    WHERE (p_regime_id IS NULL OR orr.id = p_regime_id)
    ORDER BY 3 DESC NULLS LAST
    LIMIT GREATEST(5, (p_limit + 1) / 2)
  )
  UNION ALL
  (
    SELECT
      'news'::text,
      NULL::text,
      NULL::int,
      si.title,
      si.url,
      si.published_at::text,
      NULL::jsonb,
      false
    FROM source_item si
    JOIN source s ON s.id = si.source_id
    WHERE
      (si.title ILIKE '%conjunction%'
        OR si.title ILIKE '%traffic%'
        OR si.title ILIKE '%congestion%'
        OR si.title ILIKE '%close approach%')
      AND si.fetched_at > now() - make_interval(days => p_window_days)
    ORDER BY si.published_at DESC NULLS LAST
    LIMIT GREATEST(5, (p_limit + 1) / 2)
  )
  LIMIT p_limit;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. fn_forecast_debris
-- ─────────────────────────────────────────────────────────────────────────
-- regimeId applies to `density` (orbit_regime.id join) and `fragmentation`
-- (regime_name→orbit_regime.name join). `paper`, `news`, and `weather` are
-- free-text or global signals with no structural regime linkage; those
-- branches always return branch_filter_applied = false.
--
-- horizonYears was accepted but ignored. It is removed here; space-weather
-- forecast windows (`-3d to +14d`) are planner-owned and not user-tunable.

CREATE OR REPLACE FUNCTION fn_forecast_debris(
  p_regime_id bigint DEFAULT NULL,
  p_limit     int    DEFAULT 20
)
RETURNS TABLE (
  kind                      text,
  regime_name               text,
  satellite_count           int,
  avg_mission_age           real,
  title                     text,
  abstract                  text,
  authors                   text[],
  url                       text,
  published_at              text,
  f107                      real,
  ap_index                  real,
  kp_index                  real,
  sunspot_number            real,
  weather_source            text,
  fragment_parent_name      text,
  fragment_parent_norad_id  int,
  fragment_parent_country   text,
  fragments_cataloged       int,
  fragment_parent_mass_kg   real,
  fragment_event_type       text,
  fragment_cause            text,
  branch_filter_applied     boolean
)
LANGUAGE sql STABLE AS $$
  (
    SELECT
      'density'::text,
      orr.name,
      count(s.id)::int,
      avg(s.mission_age)::real,
      NULL::text, NULL::text, NULL::text[], NULL::text, NULL::text,
      NULL::real, NULL::real, NULL::real, NULL::real, NULL::text,
      NULL::text, NULL::int, NULL::text, NULL::int, NULL::real,
      NULL::text, NULL::text,
      (p_regime_id IS NOT NULL)
    FROM orbit_regime orr
    LEFT JOIN operator_country oc ON oc.orbit_regime_id = orr.id
    LEFT JOIN satellite s         ON s.operator_country_id = oc.id
    WHERE (p_regime_id IS NULL OR orr.id = p_regime_id)
    GROUP BY orr.name
    LIMIT GREATEST(4, (p_limit + 2) / 3)
  )
  UNION ALL
  (
    SELECT
      'paper'::text,
      NULL::text, NULL::int, NULL::real,
      si.title, si.abstract, si.authors, si.url, si.published_at::text,
      NULL::real, NULL::real, NULL::real, NULL::real, NULL::text,
      NULL::text, NULL::int, NULL::text, NULL::int, NULL::real,
      NULL::text, NULL::text,
      false
    FROM source_item si
    JOIN source s ON s.id = si.source_id
    WHERE s.kind IN ('arxiv','ntrs')
      AND (si.title ~* '(debris|fragmentation|breakup)' OR si.abstract ~* 'kessler')
    ORDER BY si.published_at DESC NULLS LAST
    LIMIT GREATEST(4, (p_limit + 2) / 3)
  )
  UNION ALL
  (
    SELECT
      'news'::text,
      NULL::text, NULL::int, NULL::real,
      si.title, si.abstract, si.authors, si.url, si.published_at::text,
      NULL::real, NULL::real, NULL::real, NULL::real, NULL::text,
      NULL::text, NULL::int, NULL::text, NULL::int, NULL::real,
      NULL::text, NULL::text,
      false
    FROM source_item si
    JOIN source s ON s.id = si.source_id
    WHERE s.kind = 'rss'
      AND si.title ~* '(debris|fragmentation|breakup|kessler)'
    ORDER BY si.published_at DESC NULLS LAST
    LIMIT GREATEST(4, (p_limit + 2) / 3)
  )
  UNION ALL
  (
    SELECT DISTINCT ON (source, epoch)
      'weather'::text,
      NULL::text, NULL::int, NULL::real,
      source, NULL::text, NULL::text[], NULL::text, epoch::text,
      f107, ap_index, kp_index, sunspot_number, source,
      NULL::text, NULL::int, NULL::text, NULL::int, NULL::real,
      NULL::text, NULL::text,
      false
    FROM space_weather_forecast
    WHERE epoch >= now() - INTERVAL '3 days'
      AND epoch <= now() + INTERVAL '14 days'
    ORDER BY source, epoch, issued_at DESC
    LIMIT GREATEST(4, (p_limit + 2) / 3)
  )
  UNION ALL
  (
    SELECT
      'fragmentation'::text,
      fe.regime_name,
      NULL::int, NULL::real,
      fe.parent_name, fe.cause, NULL::text[], fe.source_url, fe.date_utc::text,
      NULL::real, NULL::real, NULL::real, NULL::real, NULL::text,
      fe.parent_name, fe.parent_norad_id, fe.parent_operator_country,
      fe.fragments_cataloged, fe.parent_mass_kg, fe.event_type, fe.cause,
      (p_regime_id IS NOT NULL)
    FROM fragmentation_event fe
    -- regime_name in fragmentation_event uses short codes ("LEO", "GEO");
    -- orbit_regime.name uses long form ("Low Earth Orbit"). Bridge the
    -- two via the same mapping used by the density branches.
    LEFT JOIN LATERAL (
      SELECT long FROM (VALUES
        ('LEO', 'Low Earth Orbit'),
        ('MEO', 'Medium Earth Orbit'),
        ('GEO', 'Geostationary Orbit'),
        ('HEO', 'Highly Elliptical Orbit'),
        ('SSO', 'Sun-Synchronous Orbit'),
        ('GTO', 'Geostationary Transfer Orbit')
      ) AS m(short, long)
      WHERE m.short = fe.regime_name
    ) m ON true
    LEFT JOIN orbit_regime orr ON orr.name = m.long
    WHERE (p_regime_id IS NULL OR orr.id = p_regime_id)
    ORDER BY fe.fragments_cataloged DESC NULLS LAST, fe.date_utc DESC NULLS LAST
    LIMIT GREATEST(4, (p_limit + 2) / 3)
  )
  LIMIT p_limit;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. fn_list_launch_manifest
-- ─────────────────────────────────────────────────────────────────────────
-- regimeId was accepted on the TS signature but no branch has structural
-- regime linkage:
--   - launch.orbit_name         : free-form text ("LEO", "SSO GTO", etc.)
--   - source_item (news/notam)  : free-text
--   - itu_filing.orbit_class    : free-form text
-- Rather than fake a fuzzy match, the parameter is dropped from the contract.
-- horizonDays already filters the `db` branch correctly and is preserved.

CREATE OR REPLACE FUNCTION fn_list_launch_manifest(
  p_horizon_days int DEFAULT 30,
  p_limit        int DEFAULT 30
)
RETURNS TABLE (
  kind                      text,
  title                     text,
  detail                    text,
  year                      int,
  vehicle                   text,
  url                       text,
  published_at              text,
  external_launch_id        text,
  operator_name             text,
  operator_country          text,
  pad_name                  text,
  pad_location              text,
  planned_net               text,
  planned_window_start      text,
  planned_window_end        text,
  status                    text,
  orbit_name                text,
  mission_name              text,
  mission_description       text,
  rideshare                 boolean,
  notam_id                  text,
  notam_state               text,
  notam_type                text,
  notam_start               text,
  notam_end                 text,
  itu_filing_id             text,
  itu_constellation         text,
  itu_administration        text,
  itu_orbit_class           text,
  itu_altitude_km           int,
  itu_planned_satellites    int,
  itu_frequency_bands       text[],
  itu_status                text
)
LANGUAGE sql STABLE AS $$
  (
    SELECT
      'db'::text,
      COALESCE(l.name, 'Launch ' || l.year::text),
      COALESCE(l.mission_description, l.vehicle),
      l.year,
      l.vehicle,
      NULL::text,
      COALESCE(l.planned_net::text, l.created_at::text),
      l.external_launch_id,
      l.operator_name,
      l.operator_country,
      l.pad_name,
      l.pad_location,
      l.planned_net::text,
      l.planned_window_start::text,
      l.planned_window_end::text,
      l.status,
      l.orbit_name,
      l.mission_name,
      l.mission_description,
      l.rideshare,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::int, NULL::int, NULL::text[], NULL::text
    FROM launch l
    WHERE (l.status IS NULL OR l.status NOT ILIKE '%stale%')
      AND l.planned_net IS NOT NULL
      AND l.planned_net >= now()
      AND l.planned_net <= now() + make_interval(days => p_horizon_days)
    ORDER BY l.planned_net ASC
    LIMIT GREATEST(5, (p_limit + 1) / 2)
  )
  UNION ALL
  (
    SELECT
      'news'::text,
      si.title,
      si.abstract,
      NULL::int,
      NULL::text,
      si.url,
      si.published_at::text,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::boolean,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::int, NULL::int, NULL::text[], NULL::text
    FROM source_item si
    JOIN source s ON s.id = si.source_id
    WHERE
      s.category ILIKE '%launch%'
      OR si.title ~* '(launch|manifest|rideshare)'
    ORDER BY si.published_at DESC NULLS LAST
    LIMIT GREATEST(5, (p_limit + 1) / 2)
  )
  UNION ALL
  (
    SELECT
      'notam'::text,
      n.notam_id,
      n.description,
      NULL::int,
      NULL::text,
      NULL::text,
      n.creation_date::text,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::boolean,
      n.notam_id, n.state, n.type,
      n.parsed_start_utc::text, n.parsed_end_utc::text,
      NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::int, NULL::int, NULL::text[], NULL::text
    FROM notam n
    WHERE n.is_launch_related = true
      AND (n.parsed_end_utc IS NULL OR n.parsed_end_utc >= now())
    ORDER BY n.parsed_start_utc DESC NULLS LAST
    LIMIT GREATEST(5, (p_limit + 1) / 2)
  )
  UNION ALL
  (
    SELECT
      'itu'::text,
      f.constellation_name,
      f.orbit_details,
      EXTRACT(year FROM f.filing_date)::int,
      NULL::text,
      f.source_url,
      f.filing_date::text,
      NULL::text,
      f.operator_name,
      f.operator_country,
      NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text,
      f.status,
      f.orbit_class,
      f.constellation_name,
      f.orbit_details,
      NULL::boolean,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      f.filing_id,
      f.constellation_name,
      f.administration,
      f.orbit_class,
      f.altitude_km,
      f.planned_satellites,
      f.frequency_bands,
      f.status
    FROM itu_filing f
    ORDER BY f.planned_satellites DESC NULLS LAST
    LIMIT GREATEST(5, (p_limit + 1) / 2)
  )
  LIMIT p_limit;
$$;

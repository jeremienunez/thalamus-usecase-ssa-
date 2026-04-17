import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  OrbitalTrafficRow,
  DebrisForecastRow,
  LaunchManifestRow,
  LaunchEpochWeatherRow,
} from "../types/traffic-forecast.types";

export type {
  OrbitalTrafficRow,
  DebrisForecastRow,
  LaunchManifestRow,
  LaunchEpochWeatherRow,
} from "../types/traffic-forecast.types";

export class TrafficForecastRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  // ← absorbed from cortices/queries/orbital-traffic.ts
  async analyzeOrbitalTraffic(
    opts: {
      windowDays?: number;
      regimeId?: string | number | bigint;
      limit?: number;
    } = {},
  ): Promise<OrbitalTrafficRow[]> {
    const windowDays = opts.windowDays ?? 30;
    const perBranchLimit = Math.max(5, Math.ceil((opts.limit ?? 30) / 2));
    const totalLimit = opts.limit ?? 30;

    const results = await this.db.execute<OrbitalTrafficRow>(sql`
      (
        -- Density: count satellites by their own regime tag in telemetry_summary
        -- (populated by the seed from SGP4 mean motion classification). Joined
        -- back to orbit_regime for display + baseline lookup.
        SELECT
          'density'::text                                    AS "kind",
          orr.name                                           AS "regimeName",
          (SELECT count(*)::int FROM satellite s2
             WHERE lower(s2.telemetry_summary->>'regime') = bd.slug) AS "satelliteCount",
          NULL::text                                         AS "title",
          NULL::text                                         AS "url",
          NULL::text                                         AS "publishedAt",
          orr.baselines                                      AS "baselines"
        FROM (VALUES
          ('leo', 'Low Earth Orbit'),
          ('meo', 'Medium Earth Orbit'),
          ('geo', 'Geostationary Orbit'),
          ('heo', 'Highly Elliptical Orbit'),
          ('sso', 'Sun-Synchronous Orbit'),
          ('gto', 'Geostationary Transfer Orbit')
        ) AS bd(slug, long_name)
        JOIN orbit_regime orr ON orr.name = bd.long_name
        ORDER BY "satelliteCount" DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      UNION ALL
      (
        SELECT
          'news'::text                    AS "kind",
          NULL::text                      AS "regimeName",
          NULL::int                       AS "satelliteCount",
          si.title                        AS "title",
          si.url                          AS "url",
          si.published_at::text           AS "publishedAt",
          NULL::jsonb                     AS "baselines"
        FROM source_item si
        JOIN source s ON s.id = si.source_id
        WHERE
          (si.title ILIKE '%conjunction%'
            OR si.title ILIKE '%traffic%'
            OR si.title ILIKE '%congestion%'
            OR si.title ILIKE '%close approach%')
          AND si.fetched_at > now() - (${windowDays} || ' days')::interval
        ORDER BY si.published_at DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      LIMIT ${totalLimit}
    `);

    return results.rows;
  }

  // ← absorbed from cortices/queries/debris-forecast.ts
  async forecastDebris(
    opts: {
      regimeId?: string | number | bigint;
      horizonYears?: number;
      limit?: number;
    } = {},
  ): Promise<DebrisForecastRow[]> {
    const perBranchLimit = Math.max(4, Math.ceil((opts.limit ?? 20) / 3));
    const totalLimit = opts.limit ?? 20;

    const results = await this.db.execute<DebrisForecastRow>(sql`
      (
        SELECT
          'density'::text                 AS "kind",
          orr.name                        AS "regimeName",
          count(s.id)::int                AS "satelliteCount",
          avg(s.mission_age)::real        AS "avgMissionAge",
          NULL::text                      AS "title",
          NULL::text                      AS "abstract",
          NULL::text[]                    AS "authors",
          NULL::text                      AS "url",
          NULL::text                      AS "publishedAt",
          NULL::real                      AS "f107",
          NULL::real                      AS "apIndex",
          NULL::real                      AS "kpIndex",
          NULL::real                      AS "sunspotNumber",
          NULL::text                      AS "weatherSource",
          NULL::text                      AS "fragmentParentName",
          NULL::int                       AS "fragmentParentNoradId",
          NULL::text                      AS "fragmentParentCountry",
          NULL::int                       AS "fragmentsCataloged",
          NULL::real                      AS "fragmentParentMassKg",
          NULL::text                      AS "fragmentEventType",
          NULL::text                      AS "fragmentCause"
        FROM orbit_regime orr
        LEFT JOIN operator_country oc ON oc.orbit_regime_id = orr.id
        LEFT JOIN satellite s         ON s.operator_country_id = oc.id
        GROUP BY orr.name
        LIMIT ${perBranchLimit}
      )
      UNION ALL
      (
        SELECT
          'paper'::text                   AS "kind",
          NULL::text                      AS "regimeName",
          NULL::int                       AS "satelliteCount",
          NULL::real                      AS "avgMissionAge",
          si.title                        AS "title",
          si.abstract                     AS "abstract",
          si.authors                      AS "authors",
          si.url                          AS "url",
          si.published_at::text           AS "publishedAt",
          NULL::real                      AS "f107",
          NULL::real                      AS "apIndex",
          NULL::real                      AS "kpIndex",
          NULL::real                      AS "sunspotNumber",
          NULL::text                      AS "weatherSource",
          NULL::text                      AS "fragmentParentName",
          NULL::int                       AS "fragmentParentNoradId",
          NULL::text                      AS "fragmentParentCountry",
          NULL::int                       AS "fragmentsCataloged",
          NULL::real                      AS "fragmentParentMassKg",
          NULL::text                      AS "fragmentEventType",
          NULL::text                      AS "fragmentCause"
        FROM source_item si
        JOIN source s ON s.id = si.source_id
        WHERE s.kind IN ('arxiv','ntrs')
          AND (
            si.title    ~* '(debris|fragmentation|breakup)'
            OR si.abstract ~* 'kessler'
          )
        ORDER BY si.published_at DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      UNION ALL
      (
        SELECT
          'news'::text                    AS "kind",
          NULL::text                      AS "regimeName",
          NULL::int                       AS "satelliteCount",
          NULL::real                      AS "avgMissionAge",
          si.title                        AS "title",
          si.abstract                     AS "abstract",
          si.authors                      AS "authors",
          si.url                          AS "url",
          si.published_at::text           AS "publishedAt",
          NULL::real                      AS "f107",
          NULL::real                      AS "apIndex",
          NULL::real                      AS "kpIndex",
          NULL::real                      AS "sunspotNumber",
          NULL::text                      AS "weatherSource",
          NULL::text                      AS "fragmentParentName",
          NULL::int                       AS "fragmentParentNoradId",
          NULL::text                      AS "fragmentParentCountry",
          NULL::int                       AS "fragmentsCataloged",
          NULL::real                      AS "fragmentParentMassKg",
          NULL::text                      AS "fragmentEventType",
          NULL::text                      AS "fragmentCause"
        FROM source_item si
        JOIN source s ON s.id = si.source_id
        WHERE s.kind = 'rss'
          AND si.title ~* '(debris|fragmentation|breakup|kessler)'
        ORDER BY si.published_at DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      UNION ALL
      (
        SELECT DISTINCT ON (source, epoch)
          'weather'::text                 AS "kind",
          NULL::text                      AS "regimeName",
          NULL::int                       AS "satelliteCount",
          NULL::real                      AS "avgMissionAge",
          source                          AS "title",
          NULL::text                      AS "abstract",
          NULL::text[]                    AS "authors",
          NULL::text                      AS "url",
          epoch::text                     AS "publishedAt",
          f107                            AS "f107",
          ap_index                        AS "apIndex",
          kp_index                        AS "kpIndex",
          sunspot_number                  AS "sunspotNumber",
          source                          AS "weatherSource",
          NULL::text                      AS "fragmentParentName",
          NULL::int                       AS "fragmentParentNoradId",
          NULL::text                      AS "fragmentParentCountry",
          NULL::int                       AS "fragmentsCataloged",
          NULL::real                      AS "fragmentParentMassKg",
          NULL::text                      AS "fragmentEventType",
          NULL::text                      AS "fragmentCause"
        FROM space_weather_forecast
        WHERE epoch >= now() - INTERVAL '3 days'
          AND epoch <= now() + INTERVAL '14 days'
        ORDER BY source, epoch, issued_at DESC
        LIMIT ${perBranchLimit}
      )
      UNION ALL
      (
        SELECT
          'fragmentation'::text           AS "kind",
          fe.regime_name                  AS "regimeName",
          NULL::int                       AS "satelliteCount",
          NULL::real                      AS "avgMissionAge",
          fe.parent_name                  AS "title",
          fe.cause                        AS "abstract",
          NULL::text[]                    AS "authors",
          fe.source_url                   AS "url",
          fe.date_utc::text               AS "publishedAt",
          NULL::real                      AS "f107",
          NULL::real                      AS "apIndex",
          NULL::real                      AS "kpIndex",
          NULL::real                      AS "sunspotNumber",
          NULL::text                      AS "weatherSource",
          fe.parent_name                  AS "fragmentParentName",
          fe.parent_norad_id              AS "fragmentParentNoradId",
          fe.parent_operator_country      AS "fragmentParentCountry",
          fe.fragments_cataloged          AS "fragmentsCataloged",
          fe.parent_mass_kg               AS "fragmentParentMassKg",
          fe.event_type                   AS "fragmentEventType",
          fe.cause                        AS "fragmentCause"
        FROM fragmentation_event fe
        -- Kessler analogs: prioritise same-regime + large events.
        ORDER BY
          fe.fragments_cataloged DESC NULLS LAST,
          fe.date_utc            DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      LIMIT ${totalLimit}
    `);

    return results.rows;
  }

  // ← absorbed from cortices/queries/launch-manifest.ts
  async listLaunchManifest(
    opts: {
      horizonDays?: number;
      regimeId?: string | number | bigint;
      limit?: number;
    } = {},
  ): Promise<LaunchManifestRow[]> {
    const perBranchLimit = Math.max(5, Math.ceil((opts.limit ?? 30) / 2));
    const totalLimit = opts.limit ?? 30;
    const horizonDays = opts.horizonDays ?? 30;

    const results = await this.db.execute<LaunchManifestRow>(sql`
      (
        SELECT
          'db'::text                                              AS "kind",
          COALESCE(l.name, 'Launch ' || l.year::text)             AS "title",
          COALESCE(l.mission_description, l.vehicle)              AS "detail",
          l.year                                                  AS "year",
          l.vehicle                                               AS "vehicle",
          NULL::text                                              AS "url",
          COALESCE(l.planned_net::text, l.created_at::text)       AS "publishedAt",
          l.external_launch_id                                    AS "externalLaunchId",
          l.operator_name                                         AS "operatorName",
          l.operator_country                                      AS "operatorCountry",
          l.pad_name                                              AS "padName",
          l.pad_location                                          AS "padLocation",
          l.planned_net::text                                     AS "plannedNet",
          l.planned_window_start::text                            AS "plannedWindowStart",
          l.planned_window_end::text                              AS "plannedWindowEnd",
          l.status                                                AS "status",
          l.orbit_name                                            AS "orbitName",
          l.mission_name                                          AS "missionName",
          l.mission_description                                   AS "missionDescription",
          l.rideshare                                             AS "rideshare",
          NULL::text                                              AS "notamId",
          NULL::text                                              AS "notamState",
          NULL::text                                              AS "notamType",
          NULL::text                                              AS "notamStart",
          NULL::text                                              AS "notamEnd",
          NULL::text                                              AS "ituFilingId",
          NULL::text                                              AS "ituConstellation",
          NULL::text                                              AS "ituAdministration",
          NULL::text                                              AS "ituOrbitClass",
          NULL::int                                               AS "ituAltitudeKm",
          NULL::int                                               AS "ituPlannedSatellites",
          NULL::text[]                                            AS "ituFrequencyBands",
          NULL::text                                              AS "ituStatus"
        FROM launch l
        -- Filter out launches expired by the LL2 ingester after they dropped
        -- off the upstream upcoming list (launched / cancelled), and bound the
        -- horizon so "upcoming in N days" queries don't receive year-end TBD
        -- placeholder rows.
        WHERE (l.status IS NULL OR l.status NOT ILIKE '%stale%')
          AND l.planned_net IS NOT NULL
          AND l.planned_net >= now()
          AND l.planned_net <= now() + make_interval(days => ${horizonDays})
        ORDER BY
          l.planned_net ASC
        LIMIT ${perBranchLimit}
      )
      UNION ALL
      (
        SELECT
          'news'::text                                    AS "kind",
          si.title                                        AS "title",
          si.abstract                                     AS "detail",
          NULL::int                                       AS "year",
          NULL::text                                      AS "vehicle",
          si.url                                          AS "url",
          si.published_at::text                           AS "publishedAt",
          NULL::text                                      AS "externalLaunchId",
          NULL::text                                      AS "operatorName",
          NULL::text                                      AS "operatorCountry",
          NULL::text                                      AS "padName",
          NULL::text                                      AS "padLocation",
          NULL::text                                      AS "plannedNet",
          NULL::text                                      AS "plannedWindowStart",
          NULL::text                                      AS "plannedWindowEnd",
          NULL::text                                      AS "status",
          NULL::text                                      AS "orbitName",
          NULL::text                                      AS "missionName",
          NULL::text                                      AS "missionDescription",
          NULL::boolean                                   AS "rideshare",
          NULL::text                                      AS "notamId",
          NULL::text                                      AS "notamState",
          NULL::text                                      AS "notamType",
          NULL::text                                      AS "notamStart",
          NULL::text                                      AS "notamEnd",
          NULL::text                                      AS "ituFilingId",
          NULL::text                                      AS "ituConstellation",
          NULL::text                                      AS "ituAdministration",
          NULL::text                                      AS "ituOrbitClass",
          NULL::int                                       AS "ituAltitudeKm",
          NULL::int                                       AS "ituPlannedSatellites",
          NULL::text[]                                    AS "ituFrequencyBands",
          NULL::text                                      AS "ituStatus"
        FROM source_item si
        JOIN source s ON s.id = si.source_id
        WHERE
          s.category ILIKE '%launch%'
          OR si.title ~* '(launch|manifest|rideshare)'
        ORDER BY si.published_at DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      UNION ALL
      (
        SELECT
          'notam'::text                                   AS "kind",
          n.notam_id                                      AS "title",
          n.description                                   AS "detail",
          NULL::int                                       AS "year",
          NULL::text                                      AS "vehicle",
          NULL::text                                      AS "url",
          n.creation_date::text                           AS "publishedAt",
          NULL::text                                      AS "externalLaunchId",
          NULL::text                                      AS "operatorName",
          NULL::text                                      AS "operatorCountry",
          NULL::text                                      AS "padName",
          NULL::text                                      AS "padLocation",
          NULL::text                                      AS "plannedNet",
          NULL::text                                      AS "plannedWindowStart",
          NULL::text                                      AS "plannedWindowEnd",
          NULL::text                                      AS "status",
          NULL::text                                      AS "orbitName",
          NULL::text                                      AS "missionName",
          NULL::text                                      AS "missionDescription",
          NULL::boolean                                   AS "rideshare",
          n.notam_id                                      AS "notamId",
          n.state                                         AS "notamState",
          n.type                                          AS "notamType",
          n.parsed_start_utc::text                        AS "notamStart",
          n.parsed_end_utc::text                          AS "notamEnd",
          NULL::text                                      AS "ituFilingId",
          NULL::text                                      AS "ituConstellation",
          NULL::text                                      AS "ituAdministration",
          NULL::text                                      AS "ituOrbitClass",
          NULL::int                                       AS "ituAltitudeKm",
          NULL::int                                       AS "ituPlannedSatellites",
          NULL::text[]                                    AS "ituFrequencyBands",
          NULL::text                                      AS "ituStatus"
        FROM notam n
        -- Only surface launch-related NOTAMs. The SPACE OPERATIONS type is
        -- the primary signal; keyword fallback covers edge cases.
        WHERE n.is_launch_related = true
          AND (
            n.parsed_end_utc IS NULL
            OR n.parsed_end_utc >= now()
          )
        ORDER BY n.parsed_start_utc DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      UNION ALL
      (
        SELECT
          'itu'::text                                     AS "kind",
          f.constellation_name                            AS "title",
          f.orbit_details                                 AS "detail",
          EXTRACT(year FROM f.filing_date)::int           AS "year",
          NULL::text                                      AS "vehicle",
          f.source_url                                    AS "url",
          f.filing_date::text                             AS "publishedAt",
          NULL::text                                      AS "externalLaunchId",
          f.operator_name                                 AS "operatorName",
          f.operator_country                              AS "operatorCountry",
          NULL::text                                      AS "padName",
          NULL::text                                      AS "padLocation",
          NULL::text                                      AS "plannedNet",
          NULL::text                                      AS "plannedWindowStart",
          NULL::text                                      AS "plannedWindowEnd",
          f.status                                        AS "status",
          f.orbit_class                                   AS "orbitName",
          f.constellation_name                            AS "missionName",
          f.orbit_details                                 AS "missionDescription",
          NULL::boolean                                   AS "rideshare",
          NULL::text                                      AS "notamId",
          NULL::text                                      AS "notamState",
          NULL::text                                      AS "notamType",
          NULL::text                                      AS "notamStart",
          NULL::text                                      AS "notamEnd",
          f.filing_id                                     AS "ituFilingId",
          f.constellation_name                            AS "ituConstellation",
          f.administration                                AS "ituAdministration",
          f.orbit_class                                   AS "ituOrbitClass",
          f.altitude_km                                   AS "ituAltitudeKm",
          f.planned_satellites                            AS "ituPlannedSatellites",
          f.frequency_bands                               AS "ituFrequencyBands",
          f.status                                        AS "ituStatus"
        FROM itu_filing f
        -- Prioritise mega-constellations (largest planned fleets first).
        ORDER BY f.planned_satellites DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      LIMIT ${totalLimit}
    `);

    return results.rows;
  }

  // ← absorbed from cortices/queries/orbit-regime.ts (stub)
  async getLaunchEpochWeather(
    _opts: {
      operatorCountryName?: string;
      operatorCountryId?: string | number;
      orbitRegime?: string;
      limit?: number;
    } = {},
  ): Promise<LaunchEpochWeatherRow[]> {
    return [];
  }
}

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export class TrafficForecastRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  // ← absorbed from cortices/queries/orbital-traffic.ts
  async analyzeOrbitalTraffic(
    opts: {
      windowDays?: number;
      regimeId?: string | number | bigint;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      kind: "density" | "news";
      regimeName: string | null;
      satelliteCount: number | null;
      title: string | null;
      url: string | null;
      publishedAt: string | null;
      baselines: Record<string, unknown> | null;
    }>
  > {
    const windowDays = opts.windowDays ?? 30;
    const perBranchLimit = Math.max(5, Math.ceil((opts.limit ?? 30) / 2));
    const totalLimit = opts.limit ?? 30;

    const results = await this.db.execute(sql`
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

    return results.rows as unknown as Array<{
      kind: "density" | "news";
      regimeName: string | null;
      satelliteCount: number | null;
      title: string | null;
      url: string | null;
      publishedAt: string | null;
      baselines: Record<string, unknown> | null;
    }>;
  }

  // ← absorbed from cortices/queries/debris-forecast.ts
  async forecastDebris(
    opts: {
      regimeId?: string | number | bigint;
      horizonYears?: number;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      kind: "density" | "paper" | "news";
      regimeName: string | null;
      satelliteCount: number | null;
      avgMissionAge: number | null;
      title: string | null;
      abstract: string | null;
      authors: string[] | null;
      url: string | null;
      publishedAt: string | null;
    }>
  > {
    const perBranchLimit = Math.max(4, Math.ceil((opts.limit ?? 20) / 3));
    const totalLimit = opts.limit ?? 20;

    const results = await this.db.execute(sql`
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
          NULL::text                      AS "publishedAt"
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
          si.published_at::text           AS "publishedAt"
        FROM source_item si
        JOIN source s ON s.id = si.source_id
        WHERE s.kind IN ('arxiv','ntrs')
          AND (
            si.title    ILIKE '%debris%'
            OR si.title ILIKE '%fragmentation%'
            OR si.title ILIKE '%breakup%'
            OR si.abstract ILIKE '%kessler%'
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
          si.published_at::text           AS "publishedAt"
        FROM source_item si
        JOIN source s ON s.id = si.source_id
        WHERE s.kind = 'rss'
          AND (
            si.title    ILIKE '%debris%'
            OR si.title ILIKE '%fragmentation%'
            OR si.title ILIKE '%breakup%'
            OR si.title ILIKE '%kessler%'
          )
        ORDER BY si.published_at DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      LIMIT ${totalLimit}
    `);

    return results.rows as unknown as Array<{
      kind: "density" | "paper" | "news";
      regimeName: string | null;
      satelliteCount: number | null;
      avgMissionAge: number | null;
      title: string | null;
      abstract: string | null;
      authors: string[] | null;
      url: string | null;
      publishedAt: string | null;
    }>;
  }

  // ← absorbed from cortices/queries/launch-manifest.ts
  async listLaunchManifest(
    opts: {
      horizonDays?: number;
      regimeId?: string | number | bigint;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      kind: "db" | "news";
      title: string;
      detail: string | null;
      year: number | null;
      vehicle: string | null;
      url: string | null;
      publishedAt: string | null;
    }>
  > {
    const perBranchLimit = Math.max(5, Math.ceil((opts.limit ?? 30) / 2));
    const totalLimit = opts.limit ?? 30;

    const results = await this.db.execute(sql`
      (
        SELECT
          'db'::text                                      AS "kind",
          COALESCE(l.name, 'Launch ' || l.year::text)     AS "title",
          l.vehicle                                       AS "detail",
          l.year                                          AS "year",
          l.vehicle                                       AS "vehicle",
          NULL::text                                      AS "url",
          l.created_at::text                              AS "publishedAt"
        FROM launch l
        ORDER BY l.year DESC NULLS LAST
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
          si.published_at::text                           AS "publishedAt"
        FROM source_item si
        JOIN source s ON s.id = si.source_id
        WHERE
          s.category ILIKE '%launch%'
          OR si.title ILIKE '%launch%'
          OR si.title ILIKE '%manifest%'
          OR si.title ILIKE '%rideshare%'
        ORDER BY si.published_at DESC NULLS LAST
        LIMIT ${perBranchLimit}
      )
      LIMIT ${totalLimit}
    `);

    return results.rows as unknown as Array<{
      kind: "db" | "news";
      title: string;
      detail: string | null;
      year: number | null;
      vehicle: string | null;
      url: string | null;
      publishedAt: string | null;
    }>;
  }

  // ← absorbed from cortices/queries/orbit-regime.ts (stub)
  async getLaunchEpochWeather(
    _opts: {
      operatorCountryName?: string;
      operatorCountryId?: string | number;
      orbitRegime?: string;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      year: number;
      operatorCountryName: string;
      orbitRegimeName: string;
      solarFluxIndex: number | null;
      solarFluxRegion: string | null;
      kpIndex: number | null;
      kpClass: string | null;
      radiationIndex: number | null;
      radiationClass: string | null;
      climate: Record<string, unknown> | null;
    }>
  > {
    return [];
  }
}

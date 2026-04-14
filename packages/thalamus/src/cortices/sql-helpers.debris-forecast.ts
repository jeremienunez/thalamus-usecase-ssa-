import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryDebrisForecast — regime density + age proxies (density) fused with
 * debris / fragmentation / Kessler scholarship (papers) and operational news.
 *
 * Three-branch UNION ALL: density, papers (arxiv/ntrs), news (rss). Column
 * arity is aligned with explicit `NULL::type` casts per branch.
 */

export interface DebrisForecastRow {
  kind: "density" | "paper" | "news";
  regimeName: string | null;
  satelliteCount: number | null;
  avgMissionAge: number | null;
  title: string | null;
  abstract: string | null;
  authors: string[] | null;
  url: string | null;
  publishedAt: string | null;
}

export async function queryDebrisForecast(
  db: Database,
  opts: {
    regimeId?: string | number | bigint;
    horizonYears?: number;
    limit?: number;
  } = {},
): Promise<DebrisForecastRow[]> {
  const perBranchLimit = Math.max(4, Math.ceil((opts.limit ?? 20) / 3));
  const totalLimit = opts.limit ?? 20;

  const results = await db.execute(sql`
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

  return results.rows as unknown as DebrisForecastRow[];
}

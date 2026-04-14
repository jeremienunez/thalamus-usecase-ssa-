import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryOrbitalTraffic — regime density proxy + traffic-related news.
 *
 * Density branch counts live satellites per orbit regime (via operator_country).
 * News branch scoops source_item titles mentioning conjunction / traffic /
 * congestion / close approach within the window.
 */

export interface OrbitalTrafficRow {
  kind: "density" | "news";
  regimeName: string | null;
  satelliteCount: number | null;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
  /** GCAT-derived regime baselines (present on density rows only). */
  baselines: Record<string, unknown> | null;
}

export async function queryOrbitalTraffic(
  db: Database,
  opts: {
    windowDays?: number;
    regimeId?: string | number | bigint;
    limit?: number;
  } = {},
): Promise<OrbitalTrafficRow[]> {
  const windowDays = opts.windowDays ?? 30;
  const perBranchLimit = Math.max(5, Math.ceil((opts.limit ?? 30) / 2));
  const totalLimit = opts.limit ?? 30;

  const results = await db.execute(sql`
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

  return results.rows as unknown as OrbitalTrafficRow[];
}

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryLaunchManifest — upcoming/recent launches fused with launch-market news.
 *
 * `launch` table rows (kind="db") UNION ALL with `source_item` rows matching
 * launch/manifest/rideshare keywords or launch-category sources (kind="news").
 */

export interface LaunchManifestRow {
  kind: "db" | "news";
  title: string;
  detail: string | null;
  year: number | null;
  vehicle: string | null;
  url: string | null;
  publishedAt: string | null;
}

export async function queryLaunchManifest(
  db: Database,
  opts: {
    horizonDays?: number;
    regimeId?: string | number | bigint;
    limit?: number;
  } = {},
): Promise<LaunchManifestRow[]> {
  const perBranchLimit = Math.max(5, Math.ceil((opts.limit ?? 30) / 2));
  const totalLimit = opts.limit ?? 30;

  const results = await db.execute(sql`
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

  return results.rows as unknown as LaunchManifestRow[];
}

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryAdvisoryFeed — operator advisories / bulletins / alerts aggregated from
 * RSS, press, field, and OSINT sources. `operatorId` is accepted for forward
 * compatibility but currently unused (source_item has no operator FK yet).
 */

export interface AdvisoryRow {
  sourceName: string;
  sourceKind: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
  score: number | null;
}

export async function queryAdvisoryFeed(
  db: Database,
  opts: {
    sinceIso?: string;
    operatorId?: string | number | bigint;
    category?: string;
    limit?: number;
  } = {},
): Promise<AdvisoryRow[]> {
  const sinceFilter = opts.sinceIso
    ? sql`AND si.fetched_at > ${opts.sinceIso}::timestamptz`
    : sql``;
  const categoryFilter = opts.category
    ? sql`AND s.category = ${opts.category}`
    : sql``;

  const results = await db.execute(sql`
    SELECT
      s.name                        AS "sourceName",
      s.kind::text                  AS "sourceKind",
      si.title                      AS "title",
      si.abstract                   AS "summary",
      si.url                        AS "url",
      si.published_at::text         AS "publishedAt",
      si.score                      AS "score"
    FROM source_item si
    JOIN source s ON s.id = si.source_id
    WHERE s.kind IN ('rss','press','field','osint')
      AND (
        s.category ILIKE '%advisor%'
        OR s.category ILIKE '%alert%'
        OR si.title  ILIKE '%advisory%'
        OR si.title  ILIKE '%bulletin%'
        OR si.title  ILIKE '%NOTAM%'
        OR si.title  ILIKE '%alert%'
        OR si.title  ILIKE '%warning%'
      )
      ${sinceFilter}
      ${categoryFilter}
    ORDER BY si.published_at DESC NULLS LAST, si.score DESC NULLS LAST
    LIMIT ${opts.limit ?? 25}
  `);

  return results.rows as unknown as AdvisoryRow[];
}

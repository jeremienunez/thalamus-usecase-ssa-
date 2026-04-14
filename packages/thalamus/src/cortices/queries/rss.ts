/**
 * SQL helpers — RSS Trend Data.
 *
 * Recent RSS items for Trend Spotter / Deal Scanner analysis.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

export interface RssTrendRow {
  sourceCategory: string;
  sourceName: string;
  title: string;
  summary: string | null;
  link: string | null;
  publishedAt: string | null;
  score: number | null;
}

export async function queryRssItems(
  db: Database,
  opts: { category?: string; days?: number; limit?: number },
): Promise<RssTrendRow[]> {
  const days = opts.days ?? 7;
  const categoryFilter = opts.category
    ? sql`AND s.category = ${opts.category}`
    : sql``;

  const results = await db.execute(sql`
    SELECT s.category as "sourceCategory", s.name as "sourceName",
      si.title, si.abstract as "summary", si.url as "link",
      si.published_at as "publishedAt",
      si.score
    FROM source_item si
    JOIN source s ON s.id = si.source_id
    WHERE s.kind = 'rss'
      AND si.fetched_at > now() - ${days + " days"}::interval
      ${categoryFilter}
    ORDER BY si.score DESC NULLS LAST, si.published_at DESC NULLS LAST
    LIMIT ${opts.limit ?? 50}
  `);

  return results.rows as unknown as RssTrendRow[];
}

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryObservationIngest — STUB helper (no `observation_track` table yet).
 *
 * Preferred: source_item from kind IN ('radar','field'). Fallback: rss matching
 * tracking / observation / radar / telescope keywords (most seeds are RSS).
 */

export interface ObservationIngestRow {
  sourceName: string;
  sourceKind: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
}

export async function queryObservationIngest(
  db: Database,
  opts: {
    stationId?: string;
    windowMinutes?: number;
    limit?: number;
  } = {},
): Promise<ObservationIngestRow[]> {
  const limit = opts.limit ?? 20;

  const preferred = await db.execute(sql`
    SELECT
      s.name                  AS "sourceName",
      s.kind::text            AS "sourceKind",
      si.title                AS "title",
      si.abstract             AS "summary",
      si.url                  AS "url",
      si.published_at::text   AS "publishedAt"
    FROM source_item si
    JOIN source s ON s.id = si.source_id
    WHERE s.kind IN ('radar','field')
    ORDER BY si.published_at DESC NULLS LAST
    LIMIT ${limit}
  `);

  if (preferred.rows.length > 0) {
    return preferred.rows as unknown as ObservationIngestRow[];
  }

  const fallback = await db.execute(sql`
    SELECT
      s.name                  AS "sourceName",
      s.kind::text            AS "sourceKind",
      si.title                AS "title",
      si.abstract             AS "summary",
      si.url                  AS "url",
      si.published_at::text   AS "publishedAt"
    FROM source_item si
    JOIN source s ON s.id = si.source_id
    WHERE s.kind = 'rss'
      AND (
        si.title    ILIKE '%tracking%'
        OR si.title ILIKE '%observation%'
        OR si.title ILIKE '%radar%'
        OR si.title ILIKE '%telescope%'
        OR si.title ILIKE '%SSA%'
      )
    ORDER BY si.published_at DESC NULLS LAST
    LIMIT ${limit}
  `);

  return fallback.rows as unknown as ObservationIngestRow[];
}

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryCorrelationMerge — STUB helper until conjunction_event+field streams
 * are modeled. Returns two `streamKind` slices of source_item: field/radar
 * (corroborating) and rss/press (hypothesis). Lets the correlation cortex
 * reason about dual-stream fusion even without a formal event table.
 */

export interface CorrelationMergeRow {
  streamKind: "field" | "osint";
  sourceName: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
  score: number | null;
}

export async function queryCorrelationMerge(
  db: Database,
  opts: {
    conjunctionEventId?: string | number | bigint;
    limit?: number;
  } = {},
): Promise<CorrelationMergeRow[]> {
  const perBranchLimit = Math.max(5, Math.ceil((opts.limit ?? 20) / 2));
  const totalLimit = opts.limit ?? 20;

  const results = await db.execute(sql`
    (
      SELECT
        'field'::text                   AS "streamKind",
        s.name                          AS "sourceName",
        si.title                        AS "title",
        si.abstract                     AS "summary",
        si.url                          AS "url",
        si.published_at::text           AS "publishedAt",
        si.score                        AS "score"
      FROM source_item si
      JOIN source s ON s.id = si.source_id
      WHERE s.kind IN ('field','radar')
      ORDER BY si.published_at DESC NULLS LAST
      LIMIT ${perBranchLimit}
    )
    UNION ALL
    (
      SELECT
        'osint'::text                   AS "streamKind",
        s.name                          AS "sourceName",
        si.title                        AS "title",
        si.abstract                     AS "summary",
        si.url                          AS "url",
        si.published_at::text           AS "publishedAt",
        si.score                        AS "score"
      FROM source_item si
      JOIN source s ON s.id = si.source_id
      WHERE s.kind IN ('rss','press','osint')
      ORDER BY si.published_at DESC NULLS LAST
      LIMIT ${perBranchLimit}
    )
    LIMIT ${totalLimit}
  `);

  return results.rows as unknown as CorrelationMergeRow[];
}

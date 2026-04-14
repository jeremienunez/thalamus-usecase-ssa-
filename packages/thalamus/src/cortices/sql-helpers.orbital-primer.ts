import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryOrbitalPrimer — explanatory content for the `orbital_analyst` cortex.
 *
 * Three-branch UNION ALL: scholarly papers (arxiv/ntrs), RSS news, and recent
 * research_finding rows from prior orbital_analyst cycles as anchors.
 * Topic filter uses ILIKE over title/abstract; if null it skips the filter.
 */

export interface OrbitalPrimerRow {
  kind: "paper" | "news" | "finding";
  title: string;
  abstract: string | null;
  authors: string[] | null;
  url: string | null;
  publishedAt: string | null;
  sourceName: string | null;
}

export async function queryOrbitalPrimer(
  db: Database,
  opts: {
    topic?: string;
    stakeholderLevel?: string;
    limit?: number;
  } = {},
): Promise<OrbitalPrimerRow[]> {
  const pattern = opts.topic ? `%${opts.topic}%` : null;
  const topicFilter = pattern
    ? sql`AND (si.title ILIKE ${pattern} OR si.abstract ILIKE ${pattern})`
    : sql``;

  const perBranchLimit = Math.max(4, Math.ceil((opts.limit ?? 20) / 3));
  const totalLimit = opts.limit ?? 20;

  const results = await db.execute(sql`
    (
      SELECT
        'paper'::text                 AS "kind",
        si.title                      AS "title",
        si.abstract                   AS "abstract",
        si.authors                    AS "authors",
        si.url                        AS "url",
        si.published_at::text         AS "publishedAt",
        s.name                        AS "sourceName"
      FROM source_item si
      JOIN source s ON s.id = si.source_id
      WHERE s.kind IN ('arxiv','ntrs')
        ${topicFilter}
      ORDER BY si.published_at DESC NULLS LAST
      LIMIT ${perBranchLimit}
    )
    UNION ALL
    (
      SELECT
        'news'::text                  AS "kind",
        si.title                      AS "title",
        si.abstract                   AS "abstract",
        si.authors                    AS "authors",
        si.url                        AS "url",
        si.published_at::text         AS "publishedAt",
        s.name                        AS "sourceName"
      FROM source_item si
      JOIN source s ON s.id = si.source_id
      WHERE s.kind = 'rss'
        ${topicFilter}
      ORDER BY si.published_at DESC NULLS LAST
      LIMIT ${perBranchLimit}
    )
    UNION ALL
    (
      SELECT
        'finding'::text               AS "kind",
        rf.title                      AS "title",
        rf.summary                    AS "abstract",
        NULL::text[]                  AS "authors",
        NULL::text                    AS "url",
        rf.created_at::text           AS "publishedAt",
        NULL::text                    AS "sourceName"
      FROM research_finding rf
      WHERE rf.cortex = 'orbital_analyst'
      ORDER BY rf.created_at DESC
      LIMIT 3
    )
    LIMIT ${totalLimit}
  `);

  return results.rows as unknown as OrbitalPrimerRow[];
}

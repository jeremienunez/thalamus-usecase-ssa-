import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryApogeeHistory — STUB (no `tle_history` table yet).
 *
 * Joins two slices: news matching TLE / apogee / perigee / decay / orbit-raise
 * keywords, plus the single satellite matching the given norad id for context.
 */

export interface ApogeeHistoryRow {
  kind: "news" | "satellite";
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
  noradId: number | null;
  meanMotion: number | null;
  inclination: number | null;
  eccentricity: number | null;
}

export async function queryApogeeHistory(
  db: Database,
  opts: {
    noradId?: string | number;
    windowDays?: number;
    limit?: number;
  } = {},
): Promise<ApogeeHistoryRow[]> {
  const perBranchLimit = Math.max(3, Math.ceil((opts.limit ?? 15) / 2));
  const totalLimit = opts.limit ?? 15;
  const norad = opts.noradId != null ? String(opts.noradId) : null;

  const newsRows = await db.execute(sql`
    SELECT
      'news'::text            AS "kind",
      si.title                AS "title",
      si.abstract             AS "summary",
      si.url                  AS "url",
      si.published_at::text   AS "publishedAt",
      NULL::int               AS "noradId",
      NULL::real              AS "meanMotion",
      NULL::real              AS "inclination",
      NULL::real              AS "eccentricity"
    FROM source_item si
    WHERE
      si.title    ILIKE '%TLE%'
      OR si.title ILIKE '%apogee%'
      OR si.title ILIKE '%perigee%'
      OR si.title ILIKE '%decay%'
      OR si.title ILIKE '%orbit raise%'
    ORDER BY si.published_at DESC NULLS LAST
    LIMIT ${perBranchLimit}
  `);

  const satRows = norad
    ? await db.execute(sql`
        SELECT
          'satellite'::text                                        AS "kind",
          s.name                                                   AS "title",
          s.g_short_description                                    AS "summary",
          NULL::text                                               AS "url",
          s.created_at::text                                       AS "publishedAt",
          NULLIF(s.telemetry_summary->>'noradId','')::int          AS "noradId",
          NULLIF(s.telemetry_summary->>'meanMotion','')::real      AS "meanMotion",
          NULLIF(s.telemetry_summary->>'inclination','')::real     AS "inclination",
          NULLIF(s.telemetry_summary->>'eccentricity','')::real    AS "eccentricity"
        FROM satellite s
        WHERE s.telemetry_summary->>'noradId' = ${norad}
        LIMIT 1
      `)
    : { rows: [] as unknown[] };

  const combined = [
    ...(newsRows.rows as unknown as ApogeeHistoryRow[]),
    ...(satRows.rows as unknown as ApogeeHistoryRow[]),
  ].slice(0, totalLimit);

  return combined;
}

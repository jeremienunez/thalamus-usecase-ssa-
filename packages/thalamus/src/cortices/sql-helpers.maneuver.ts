import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryManeuverPlan — STUB helper (no `maneuver` table yet). Returns source_item
 * rows discussing burns / delta-v / station-keeping / collision avoidance for the
 * LLM to reason about plan archetypes.
 */

export interface ManeuverPlanRow {
  sourceName: string;
  sourceKind: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
}

export async function queryManeuverPlan(
  db: Database,
  opts: {
    conjunctionEventId?: string | number | bigint;
    maxDeltaVmps?: number;
    limit?: number;
  } = {},
): Promise<ManeuverPlanRow[]> {
  const results = await db.execute(sql`
    SELECT
      s.name                         AS "sourceName",
      s.kind::text                   AS "sourceKind",
      si.title                       AS "title",
      si.abstract                    AS "summary",
      si.url                         AS "url",
      si.published_at::text          AS "publishedAt"
    FROM source_item si
    JOIN source s ON s.id = si.source_id
    WHERE
      si.title    ILIKE '%maneuver%'
      OR si.title ILIKE '%burn%'
      OR si.title ILIKE '%delta-v%'
      OR si.title ILIKE '%station-keeping%'
      OR si.title ILIKE '%avoidance%'
      OR si.abstract ILIKE '%delta-v%'
    ORDER BY si.published_at DESC NULLS LAST
    LIMIT ${opts.limit ?? 15}
  `);

  return results.rows as unknown as ManeuverPlanRow[];
}

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryCatalogIngest — recent satellites with their operator / country / platform /
 * regime labels, as the `catalog` cortex's ingestion view.
 *
 * Reads live `satellite` + standard joins. Regime lives on `operator_country`.
 * `noradId` is pulled from `telemetry_summary->>'noradId'` (set by the CelesTrak
 * seed script) — not a column.
 */

export interface CatalogIngestRow {
  satelliteId: number;
  name: string;
  noradId: number | null;
  operator: string | null;
  operatorCountry: string | null;
  platformClass: string | null;
  orbitRegime: string | null;
  launchYear: number | null;
  ingestedAt: string;
}

export async function queryCatalogIngest(
  db: Database,
  opts: { source?: string; sinceEpoch?: string; limit?: number } = {},
): Promise<CatalogIngestRow[]> {
  const sinceFilter = opts.sinceEpoch
    ? sql`AND s.created_at > ${opts.sinceEpoch}::timestamptz`
    : sql``;

  const results = await db.execute(sql`
    SELECT
      s.id::int AS "satelliteId",
      s.name,
      NULLIF(s.telemetry_summary->>'noradId', '')::int AS "noradId",
      op.name AS "operator",
      oc.name AS "operatorCountry",
      pc.name AS "platformClass",
      orr.name AS "orbitRegime",
      s.launch_year AS "launchYear",
      s.created_at::text AS "ingestedAt"
    FROM satellite s
    LEFT JOIN operator op            ON op.id  = s.operator_id
    LEFT JOIN operator_country oc    ON oc.id  = s.operator_country_id
    LEFT JOIN platform_class pc      ON pc.id  = s.platform_class_id
    LEFT JOIN orbit_regime orr       ON orr.id = oc.orbit_regime_id
    WHERE 1 = 1
      ${sinceFilter}
    ORDER BY s.created_at DESC
    LIMIT ${opts.limit ?? 50}
  `);

  return results.rows as unknown as CatalogIngestRow[];
}

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryOrbitSlotPlan — who owns how much of each orbital regime.
 *
 * No ITU filings modeled yet; this is a density proxy: count satellites per
 * (regime × operator) and compute share-of-regime percentage. Lets the
 * `orbit_slot_optimizer` cortex reason about congestion and operator exposure.
 */

export interface OrbitSlotRow {
  regimeId: number;
  regimeName: string;
  operatorId: number | null;
  operatorName: string | null;
  satellitesInRegime: number;
  shareOfRegimePct: number;
}

export async function queryOrbitSlotPlan(
  db: Database,
  opts: {
    operatorId?: string | number | bigint;
    horizonYears?: number;
    limit?: number;
  } = {},
): Promise<OrbitSlotRow[]> {
  const opFilter = opts.operatorId
    ? sql`AND op.id = ${BigInt(opts.operatorId as string | number)}`
    : sql``;

  const results = await db.execute(sql`
    WITH regime_totals AS (
      SELECT oc.orbit_regime_id AS rid, count(s.id)::int AS total
      FROM satellite s
      JOIN operator_country oc ON oc.id = s.operator_country_id
      WHERE oc.orbit_regime_id IS NOT NULL
      GROUP BY oc.orbit_regime_id
    )
    SELECT
      orr.id::int AS "regimeId",
      orr.name   AS "regimeName",
      op.id::int AS "operatorId",
      op.name    AS "operatorName",
      count(s.id)::int AS "satellitesInRegime",
      (count(s.id) * 100.0 / NULLIF(rt.total, 0))::real AS "shareOfRegimePct"
    FROM satellite s
    JOIN operator_country oc  ON oc.id = s.operator_country_id
    JOIN orbit_regime orr     ON orr.id = oc.orbit_regime_id
    LEFT JOIN operator op     ON op.id = s.operator_id
    JOIN regime_totals rt     ON rt.rid = orr.id
    WHERE 1 = 1
      ${opFilter}
    GROUP BY orr.id, orr.name, op.id, op.name, rt.total
    ORDER BY "shareOfRegimePct" DESC NULLS LAST
    LIMIT ${opts.limit ?? 20}
  `);

  return results.rows as unknown as OrbitSlotRow[];
}

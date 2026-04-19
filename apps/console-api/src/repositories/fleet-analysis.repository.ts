import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  FleetAnalysisRow,
  RegimeProfileRow,
  OrbitSlotRow,
} from "../types/fleet-analysis.types";
import {
  operatorFleetRollupSql,
  type OperatorFleetRollupRow,
} from "./queries/operator-fleet-rollup";

export type {
  FleetAnalysisRow,
  RegimeProfileRow,
  OrbitSlotRow,
} from "../types/fleet-analysis.types";

export class FleetAnalysisRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async analyzeOperatorFleet(
    opts: {
      operatorId?: string | number | bigint;
      limit?: number;
    } = {},
  ): Promise<FleetAnalysisRow[]> {
    const operatorId =
      opts.operatorId == null
        ? null
        : BigInt(opts.operatorId as string | number);
    const results = await this.db.execute<OperatorFleetRollupRow>(
      operatorFleetRollupSql({ operatorId, limit: opts.limit ?? 10 }),
    );
    const currentYear = new Date().getUTCFullYear();
    return results.rows.map((r) => ({
      operatorId: r.operatorId,
      operatorName: r.operatorName,
      country: r.country,
      satelliteCount: r.satelliteCount,
      avgAgeYears:
        r.avgLaunchYear == null ? null : currentYear - r.avgLaunchYear,
      regimeMix: r.regimeMix ?? [],
      platformMix: r.platformMix ?? [],
      busMix: r.busMix ?? [],
    }));
  }

  // ← absorbed from cortices/queries/orbit-regime.ts
  async profileOrbitRegime(
    opts: {
      operatorCountryName?: string;
      operatorCountryId?: string | number;
      orbitRegime?: string;
      limit?: number;
    } = {},
  ): Promise<RegimeProfileRow[]> {
    const limit = opts.limit ?? 10;

    let filter = sql``;
    if (opts.operatorCountryId !== undefined) {
      filter = sql`AND oc.id = ${BigInt(opts.operatorCountryId)}`;
    } else if (opts.operatorCountryName) {
      filter = sql`AND oc.name = ${opts.operatorCountryName}`;
    } else if (opts.orbitRegime) {
      filter = sql`AND orr.name = ${opts.orbitRegime}`;
    }

    const results = await this.db.execute<RegimeProfileRow>(sql`
      WITH regime_counts AS (
        SELECT
          orr.id AS regime_id,
          orr.name AS regime_name,
          orr.altitude_band,
          oc.id AS operator_country_id,
          oc.name AS operator_country_name,
          oc.doctrine,
          s.id AS satellite_id,
          s.operator_id,
          op.name AS operator_name
        FROM orbit_regime orr
        JOIN operator_country oc ON oc.orbit_regime_id = orr.id
        LEFT JOIN satellite s ON s.operator_country_id = oc.id
        LEFT JOIN operator op ON op.id = s.operator_id
        WHERE 1=1 ${filter}
      ),
      operator_counts AS (
        SELECT
          regime_id,
          operator_country_id,
          operator_id,
          operator_name,
          count(satellite_id)::int AS sat_count
        FROM regime_counts
        WHERE operator_id IS NOT NULL
        GROUP BY regime_id, operator_country_id, operator_id, operator_name
      ),
      top_operators AS (
        SELECT
          regime_id,
          operator_country_id,
          (ARRAY_AGG(operator_name ORDER BY sat_count DESC))[1:5] AS top_ops,
          count(DISTINCT operator_id)::int AS operator_count
        FROM operator_counts
        GROUP BY regime_id, operator_country_id
      ),
      agg AS (
        SELECT
          regime_id,
          regime_name,
          altitude_band,
          operator_country_id,
          operator_country_name,
          doctrine,
          count(satellite_id)::int AS sat_count
        FROM regime_counts
        GROUP BY regime_id, regime_name, altitude_band, operator_country_id, operator_country_name, doctrine
      )
      SELECT
        a.regime_id::text AS "regimeId",
        a.regime_name AS "regimeName",
        a.altitude_band AS "altitudeBand",
        a.operator_country_id::text AS "operatorCountryId",
        a.operator_country_name AS "operatorCountryName",
        a.sat_count AS "satelliteCount",
        COALESCE(t.operator_count, 0) AS "operatorCount",
        COALESCE(t.top_ops, ARRAY[]::text[]) AS "topOperators",
        CASE
          WHEN a.doctrine IS NULL OR jsonb_typeof(a.doctrine) <> 'object' THEN ARRAY[]::text[]
          ELSE ARRAY(SELECT jsonb_object_keys(a.doctrine))
        END AS "doctrineKeys"
      FROM agg a
      LEFT JOIN top_operators t
        ON t.regime_id = a.regime_id
       AND t.operator_country_id = a.operator_country_id
      ORDER BY a.sat_count DESC
      LIMIT ${limit}
    `);

    return results.rows.map((r) => ({
      ...r,
      regimeId: String(r.regimeId),
      operatorCountryId:
        r.operatorCountryId == null ? null : String(r.operatorCountryId),
      topOperators: (r.topOperators ?? []).filter(
        (x): x is string => x != null,
      ),
      doctrineKeys: r.doctrineKeys ?? [],
    }));
  }

  async planOrbitSlots(
    opts: {
      operatorId?: string | number | bigint;
      limit?: number;
    } = {},
  ): Promise<OrbitSlotRow[]> {
    const operatorId =
      opts.operatorId == null
        ? null
        : BigInt(opts.operatorId as string | number);
    const results = await this.db.execute<OrbitSlotRow>(sql`
      SELECT
        regime_id            AS "regimeId",
        regime_name          AS "regimeName",
        operator_id          AS "operatorId",
        operator_name        AS "operatorName",
        satellites_in_regime AS "satellitesInRegime",
        share_of_regime_pct  AS "shareOfRegimePct"
      FROM fn_plan_orbit_slots(${operatorId}::bigint, ${opts.limit ?? 20}::int)
    `);
    return results.rows;
  }
}

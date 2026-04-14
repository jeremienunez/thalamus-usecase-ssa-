/**
 * SQL helpers — Orbit Regime Profile.
 *
 * Aggregates satellites and operators per orbital regime / operator-country,
 * exposing doctrine keys for downstream reasoning. The former epoch-weather
 * joins have been removed — that table is not present in the live DB.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

// ============================================================================
// Launch-epoch space weather — STUB
// ============================================================================

/** STUB: epoch-weather table not in live DB. Retained for API compatibility. */
export interface LaunchEpochWeatherRow {
  year: number;
  operatorCountryName: string;
  orbitRegimeName: string;
  solarFluxIndex: number | null;
  solarFluxRegion: string | null;
  kpIndex: number | null;
  kpClass: string | null;
  radiationIndex: number | null;
  radiationClass: string | null;
  climate: Record<string, unknown> | null;
}

/** STUB: epoch-weather table not in live DB. */
export async function queryLaunchEpochWeather(
  _db: Database,
  _opts: {
    operatorCountryName?: string;
    operatorCountryId?: string | number;
    orbitRegime?: string;
    limit?: number;
  } = {},
): Promise<LaunchEpochWeatherRow[]> {
  return [];
}

// ============================================================================
// Orbit regime profile
// ============================================================================

export interface OrbitRegimeProfileRow {
  regimeId: string;
  regimeName: string;
  altitudeBand: string | null;
  operatorCountryId: string | null;
  operatorCountryName: string | null;
  satelliteCount: number;
  operatorCount: number;
  topOperators: string[];
  doctrineKeys: string[];
}

export async function queryOrbitRegimeProfile(
  db: Database,
  opts: {
    operatorCountryName?: string;
    operatorCountryId?: string | number;
    orbitRegime?: string;
    limit?: number;
  } = {},
): Promise<OrbitRegimeProfileRow[]> {
  const limit = opts.limit ?? 10;

  let filter = sql``;
  if (opts.operatorCountryId !== undefined) {
    filter = sql`AND oc.id = ${BigInt(opts.operatorCountryId)}`;
  } else if (opts.operatorCountryName) {
    filter = sql`AND oc.name = ${opts.operatorCountryName}`;
  } else if (opts.orbitRegime) {
    filter = sql`AND orr.name = ${opts.orbitRegime}`;
  }

  const results = await db.execute(sql`
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

  return (results.rows as unknown as OrbitRegimeProfileRow[]).map((r) => ({
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

export const queryRegimeProfile = queryOrbitRegimeProfile;

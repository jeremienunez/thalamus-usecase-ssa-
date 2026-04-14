/**
 * SQL helpers — Satellite catalog & mission health.
 *
 * Joins `satellite` with `operator`, `operatorCountry`, `platformClass`
 * and `orbitRegime` to answer catalog / fleet-health questions used by
 * the satellite-quality and apogee/station-keeping cortices.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

// ============================================================================
// Satellite catalog rows
// ============================================================================

export interface SatelliteRow {
  id: bigint;
  name: string;
  slug: string;
  launchYear: number | null;
  operatorName: string | null;
  operatorId: bigint | null;
  operatorCountryName: string | null;
  operatorCountryId: bigint | null;
  platformClassName: string | null;
  platformClassId: bigint | null;
  orbitRegimeName: string | null;
  orbitRegimeId: bigint | null;
  telemetrySummary: Record<string, unknown> | null;
}

/**
 * Look up a single satellite by internal id, with operator / country / class
 * / regime joined in. Returns null when not found.
 */
export async function findSatelliteById(
  db: Database,
  id: bigint | number,
): Promise<SatelliteRow | null> {
  const results = await db.execute(sql`
    SELECT
      s.id, s.name, s.slug,
      s.launch_year as "launchYear",
      op.name as "operatorName", op.id as "operatorId",
      oc.name as "operatorCountryName", oc.id as "operatorCountryId",
      pc.name as "platformClassName", pc.id as "platformClassId",
      orr.name as "orbitRegimeName", orr.id as "orbitRegimeId",
      s.telemetry_summary as "telemetrySummary"
    FROM satellite s
    LEFT JOIN operator op ON op.id = s.operator_id
    LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
    LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
    LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
    WHERE s.id = ${BigInt(id)}
    LIMIT 1
  `);

  const row = results.rows[0];
  return row ? (row as unknown as SatelliteRow) : null;
}

/**
 * List satellites flown by a given operator (by name), joined with country /
 * platform class / orbit regime. Used by fleet-health and mission cortices.
 */
export async function listSatellitesByOperator(
  db: Database,
  opts: { operator?: string; limit?: number },
): Promise<SatelliteRow[]> {
  const operatorFilter = opts.operator
    ? sql`AND op.name = ${opts.operator}`
    : sql``;

  const results = await db.execute(sql`
    SELECT
      s.id, s.name, s.slug,
      s.launch_year as "launchYear",
      op.name as "operatorName", op.id as "operatorId",
      oc.name as "operatorCountryName", oc.id as "operatorCountryId",
      pc.name as "platformClassName", pc.id as "platformClassId",
      orr.name as "orbitRegimeName", orr.id as "orbitRegimeId",
      s.telemetry_summary as "telemetrySummary"
    FROM satellite s
    LEFT JOIN operator op ON op.id = s.operator_id
    LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
    LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
    LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
    WHERE 1 = 1
      ${operatorFilter}
    ORDER BY s.launch_year DESC NULLS LAST, s.name ASC
    LIMIT ${opts.limit ?? 200}
  `);

  return results.rows as unknown as SatelliteRow[];
}

// ============================================================================
// Mission-health windows (apogee / end-of-life tracker)
// ============================================================================

export interface SatelliteMissionWindowRow extends SatelliteRow {
  currentPhase: string | null;
  nominalLifeYears: number | null;
  maxLifeYears: number | null;
  currentAgeYears: number | null;
  yearsToEol: number | null;
}

/**
 * Project mission windows for satellites in a given orbit regime (or all).
 * Notional `safe_mission_window()` SQL UDF is expected to mirror the
 * drinking-window proxy shape from the source domain.
 */
export async function listSatelliteMissionWindows(
  db: Database,
  opts: { orbitRegime?: string; limit?: number },
): Promise<SatelliteMissionWindowRow[]> {
  const regimeFilter = opts.orbitRegime
    ? sql`AND orr.name = ${opts.orbitRegime}`
    : sql``;

  const results = await db.execute(sql`
    WITH satellite_base AS (
      SELECT
        s.id, s.name, s.slug,
        s.launch_year as "launchYear",
        op.name as "operatorName", op.id as "operatorId",
        oc.name as "operatorCountryName", oc.id as "operatorCountryId",
        pc.name as "platformClassName", pc.id as "platformClassId",
        orr.name as "orbitRegimeName", orr.id as "orbitRegimeId",
        s.telemetry_summary as "telemetrySummary"
      FROM satellite s
      LEFT JOIN operator op ON op.id = s.operator_id
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
      LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
      WHERE s.launch_year IS NOT NULL
        AND s.launch_year > 1957
        ${regimeFilter}
    )
    SELECT sb.*,
      (mw.result->>'current_phase') as "currentPhase",
      (mw.result->>'nominal_life_years')::real as "nominalLifeYears",
      (mw.result->>'max_life_years')::real as "maxLifeYears",
      (mw.result->>'current_age_years')::real as "currentAgeYears",
      GREATEST(0, (mw.result->>'nominal_life_years')::real
        - COALESCE((mw.result->>'current_age_years')::real, 0)) as "yearsToEol"
    FROM satellite_base sb
    LEFT JOIN LATERAL (SELECT safe_mission_window(sb.id) as result) mw ON true
    WHERE (mw.result->>'current_phase') IS NOT NULL
    ORDER BY GREATEST(0, (mw.result->>'nominal_life_years')::real
      - COALESCE((mw.result->>'current_age_years')::real, 0)) ASC NULLS LAST
    LIMIT ${opts.limit ?? 200}
  `);

  return results.rows as unknown as SatelliteMissionWindowRow[];
}

/**
 * SQL helpers — Data Quality Audit.
 *
 * Per-regime audit of the satellite catalog using ONLY live columns:
 * mass_kg, launch_year, telemetry_summary (jsonb), 14 telemetry scalars,
 * and FK integrity (operator_id, operator_country_id, platform_class_id).
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

export interface DataAuditRow {
  regimeId: string | null;
  regimeName: string | null;
  satellitesInRegime: number;
  missingMass: number;
  missingLaunchYear: number;
  outOfRangeLaunchYear: number;
  missingOperator: number;
  missingOperatorCountry: number;
  missingPlatformClass: number;
  missingTelemetrySummary: number;
  avgTelemetryScalarNullCount: number;
  flaggedCount: number;
}

export async function querySatelliteDataAudit(
  db: Database,
  opts: { orbitRegime?: string; limit?: number } = {},
): Promise<DataAuditRow[]> {
  const limit = opts.limit ?? 20;
  const regimeFilter = opts.orbitRegime
    ? sql`AND orr.name = ${opts.orbitRegime}`
    : sql``;

  const results = await db.execute(sql`
    WITH base AS (
      SELECT
        orr.id AS regime_id,
        orr.name AS regime_name,
        s.id AS satellite_id,
        s.mass_kg,
        s.launch_year,
        s.operator_id,
        s.operator_country_id,
        s.platform_class_id,
        s.telemetry_summary,
        (CASE WHEN s.power_draw IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.thermal_margin IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.pointing_accuracy IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.attitude_rate IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.link_budget IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.data_rate IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.payload_duty IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.eclipse_ratio IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.solar_array_health IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.battery_depth_of_discharge IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.propellant_remaining IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.radiation_dose IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.debris_proximity IS NULL THEN 1 ELSE 0 END
         + CASE WHEN s.mission_age IS NULL THEN 1 ELSE 0 END)::int AS tel_null_count
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
      WHERE 1=1 ${regimeFilter}
    ),
    flagged AS (
      SELECT
        regime_id,
        satellite_id,
        ((CASE WHEN mass_kg IS NULL OR mass_kg <= 0 THEN 1 ELSE 0 END)
         + (CASE WHEN launch_year IS NULL THEN 1 ELSE 0 END)
         + (CASE WHEN launch_year IS NOT NULL AND (launch_year < 1957 OR launch_year > 2030) THEN 1 ELSE 0 END)
         + (CASE WHEN operator_id IS NULL THEN 1 ELSE 0 END)
         + (CASE WHEN operator_country_id IS NULL THEN 1 ELSE 0 END)
         + (CASE WHEN platform_class_id IS NULL THEN 1 ELSE 0 END)
         + (CASE WHEN telemetry_summary IS NULL OR jsonb_typeof(telemetry_summary) = 'null' THEN 1 ELSE 0 END)
         + (CASE WHEN tel_null_count >= 7 THEN 1 ELSE 0 END)) AS issue_count
      FROM base
    )
    SELECT
      b.regime_id::text AS "regimeId",
      b.regime_name AS "regimeName",
      count(*)::int AS "satellitesInRegime",
      sum(CASE WHEN b.mass_kg IS NULL OR b.mass_kg <= 0 THEN 1 ELSE 0 END)::int AS "missingMass",
      sum(CASE WHEN b.launch_year IS NULL THEN 1 ELSE 0 END)::int AS "missingLaunchYear",
      sum(CASE WHEN b.launch_year IS NOT NULL AND (b.launch_year < 1957 OR b.launch_year > 2030) THEN 1 ELSE 0 END)::int AS "outOfRangeLaunchYear",
      sum(CASE WHEN b.operator_id IS NULL THEN 1 ELSE 0 END)::int AS "missingOperator",
      sum(CASE WHEN b.operator_country_id IS NULL THEN 1 ELSE 0 END)::int AS "missingOperatorCountry",
      sum(CASE WHEN b.platform_class_id IS NULL THEN 1 ELSE 0 END)::int AS "missingPlatformClass",
      sum(CASE WHEN b.telemetry_summary IS NULL OR jsonb_typeof(b.telemetry_summary) = 'null' THEN 1 ELSE 0 END)::int AS "missingTelemetrySummary",
      COALESCE(avg(b.tel_null_count)::numeric(5,2), 0)::float AS "avgTelemetryScalarNullCount",
      (SELECT count(*)::int FROM flagged f WHERE f.regime_id IS NOT DISTINCT FROM b.regime_id AND f.issue_count >= 3) AS "flaggedCount"
    FROM base b
    GROUP BY b.regime_id, b.regime_name
    ORDER BY "satellitesInRegime" DESC
    LIMIT ${limit}
  `);

  return (results.rows as unknown as DataAuditRow[]).map((r) => ({
    ...r,
    regimeId: r.regimeId == null ? null : String(r.regimeId),
  }));
}

export const queryDataAudit = querySatelliteDataAudit;

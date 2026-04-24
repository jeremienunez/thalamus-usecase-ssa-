import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { Regime } from "@interview/shared";
import {
  satelliteDimensionJoinsSql,
  satelliteOrbitRegimeJoinSql,
} from "./satellite-dimension.sql";
import type {
  SatelliteOrbitalRow,
  SatelliteNameRow,
} from "../types/satellite.types";

export type {
  SatelliteOrbitalRow,
  SatelliteNameRow,
} from "../types/satellite.types";

/**
 * SatelliteViewRepository owns catalog reads used by the operator console UI
 * and mission-planning views. Dimension lookups shared with other flows live
 * in SatelliteDimensionRepository.
 */
export class SatelliteViewRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async listWithOrbital(
    limit: number,
    regime?: Regime,
  ): Promise<SatelliteOrbitalRow[]> {
    // Regime filter pushed to SQL so it composes with LIMIT correctly.
    // Prefer the explicit regime field on telemetry_summary when present;
    // otherwise derive from meanMotion using the same thresholds as
    // regimeFromMeanMotion() in @interview/shared
    // (<1.1 -> GEO, <5 -> MEO, <11 -> HEO, else LEO).
    const regimeFilter = regime
      ? sql`AND COALESCE(
          UPPER(NULLIF(s.telemetry_summary->>'regime', '')),
          CASE
            WHEN (s.telemetry_summary->>'meanMotion')::float < 1.1 THEN 'GEO'
            WHEN (s.telemetry_summary->>'meanMotion')::float < 5   THEN 'MEO'
            WHEN (s.telemetry_summary->>'meanMotion')::float < 11  THEN 'HEO'
            ELSE 'LEO'
          END
        ) = ${regime}`
      : sql``;

    const rows = await this.db.execute<SatelliteOrbitalRow>(sql`
      SELECT
        s.id::text                                       AS id,
        s.name,
        NULLIF(s.telemetry_summary->>'noradId','')::int  AS norad_id,
        op.name                                          AS operator,
        oc.name                                          AS operator_country,
        s.launch_year,
        s.mass_kg,
        s.classification_tier,
        s.opacity_score::text,
        s.telemetry_summary,
        s.object_class,
        s.photo_url,
        s.g_short_description,
        s.g_description,
        pc.name                                          AS platform_class_name,
        sb.name                                          AS bus_name,
        sb.generation                                    AS bus_generation,
        s.power_draw,
        s.thermal_margin,
        s.pointing_accuracy,
        s.attitude_rate,
        s.link_budget,
        s.data_rate,
        s.payload_duty,
        s.eclipse_ratio,
        s.solar_array_health,
        s.battery_depth_of_discharge,
        s.propellant_remaining,
        s.radiation_dose,
        s.debris_proximity,
        s.mission_age,
        th_latest.last_tle_ingested_at,
        (th_latest.latest_mm - th_prev.prev_mm)::real AS mean_motion_drift
      FROM satellite s
      ${satelliteDimensionJoinsSql}
      LEFT JOIN LATERAL (
        SELECT ingested_at AS last_tle_ingested_at, mean_motion AS latest_mm
        FROM tle_history
        WHERE satellite_id = s.id
        ORDER BY ingested_at DESC
        LIMIT 1
      ) th_latest ON TRUE
      LEFT JOIN LATERAL (
        SELECT mean_motion AS prev_mm
        FROM tle_history
        WHERE satellite_id = s.id
        ORDER BY ingested_at DESC
        OFFSET 1 LIMIT 1
      ) th_prev ON TRUE
      WHERE s.telemetry_summary ? 'raan'
        ${regimeFilter}
      ORDER BY s.id
      LIMIT ${limit}
    `);
    return rows.rows;
  }

  async findPayloadNamesByIds(ids: bigint[]): Promise<SatelliteNameRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.execute<SatelliteNameRow>(sql`
      SELECT id::text, name, norad_id::text
      FROM satellite
      WHERE id = ANY(${sql`ARRAY[${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}]::bigint[]`})
        AND object_class = 'payload'
    `);
    return rows.rows;
  }

  /** Mission windows with EOL projections. */
  async listMissionWindows(
    opts: { orbitRegime?: string; limit?: number },
  ): Promise<
    Array<{
      id: bigint;
      name: string;
      slug: string;
      noradId: number | null;
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
      currentPhase: string | null;
      nominalLifeYears: number | null;
      maxLifeYears: number | null;
      currentAgeYears: number | null;
      yearsToEol: number | null;
    }>
  > {
    const regimeFilter = opts.orbitRegime
      ? sql`AND orr.name = ${opts.orbitRegime}`
      : sql``;

    const results = await this.db.execute<{
      id: bigint;
      name: string;
      slug: string;
      noradId: number | null;
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
      currentPhase: string | null;
      nominalLifeYears: number | null;
      maxLifeYears: number | null;
      currentAgeYears: number | null;
      yearsToEol: number | null;
    }>(sql`
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
        ${satelliteDimensionJoinsSql}
        ${satelliteOrbitRegimeJoinSql}
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

    return results.rows;
  }
}

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  OrbitalTrafficRow,
  DebrisForecastRow,
  LaunchManifestRow,
  LaunchEpochWeatherRow,
} from "../types/orbital-analysis.types";

export type {
  OrbitalTrafficRow,
  DebrisForecastRow,
  LaunchManifestRow,
  LaunchEpochWeatherRow,
} from "../types/orbital-analysis.types";

export class TrafficForecastRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async analyzeOrbitalTraffic(
    opts: {
      windowDays?: number;
      regimeId?: string | number | bigint;
      limit?: number;
    } = {},
  ): Promise<OrbitalTrafficRow[]> {
    const regimeId =
      opts.regimeId == null
        ? null
        : BigInt(opts.regimeId as string | number);
    const results = await this.db.execute<OrbitalTrafficRow>(sql`
      SELECT
        kind,
        regime_name             AS "regimeName",
        satellite_count         AS "satelliteCount",
        title,
        url,
        published_at            AS "publishedAt",
        baselines,
        branch_filter_applied   AS "branchFilterApplied"
      FROM fn_analyze_orbital_traffic(
        ${opts.windowDays ?? 30}::int,
        ${regimeId}::bigint,
        ${opts.limit ?? 30}::int
      )
    `);
    return results.rows;
  }

  async forecastDebris(
    opts: {
      regimeId?: string | number | bigint;
      limit?: number;
    } = {},
  ): Promise<DebrisForecastRow[]> {
    const regimeId =
      opts.regimeId == null
        ? null
        : BigInt(opts.regimeId as string | number);
    const results = await this.db.execute<DebrisForecastRow>(sql`
      SELECT
        kind,
        regime_name                AS "regimeName",
        satellite_count            AS "satelliteCount",
        avg_mission_age            AS "avgMissionAge",
        title,
        abstract,
        authors,
        url,
        published_at               AS "publishedAt",
        f107,
        ap_index                   AS "apIndex",
        kp_index                   AS "kpIndex",
        sunspot_number             AS "sunspotNumber",
        weather_source             AS "weatherSource",
        fragment_parent_name       AS "fragmentParentName",
        fragment_parent_norad_id   AS "fragmentParentNoradId",
        fragment_parent_country    AS "fragmentParentCountry",
        fragments_cataloged        AS "fragmentsCataloged",
        fragment_parent_mass_kg    AS "fragmentParentMassKg",
        fragment_event_type        AS "fragmentEventType",
        fragment_cause             AS "fragmentCause",
        branch_filter_applied      AS "branchFilterApplied"
      FROM fn_forecast_debris(
        ${regimeId}::bigint,
        ${opts.limit ?? 20}::int
      )
    `);
    return results.rows;
  }

  async listLaunchManifest(
    opts: {
      horizonDays?: number;
      limit?: number;
    } = {},
  ): Promise<LaunchManifestRow[]> {
    const results = await this.db.execute<LaunchManifestRow>(sql`
      SELECT
        kind,
        title,
        detail,
        year,
        vehicle,
        url,
        published_at             AS "publishedAt",
        external_launch_id       AS "externalLaunchId",
        operator_name            AS "operatorName",
        operator_country         AS "operatorCountry",
        pad_name                 AS "padName",
        pad_location             AS "padLocation",
        planned_net              AS "plannedNet",
        planned_window_start     AS "plannedWindowStart",
        planned_window_end       AS "plannedWindowEnd",
        status,
        orbit_name               AS "orbitName",
        mission_name             AS "missionName",
        mission_description      AS "missionDescription",
        rideshare,
        notam_id                 AS "notamId",
        notam_state              AS "notamState",
        notam_type               AS "notamType",
        notam_start              AS "notamStart",
        notam_end                AS "notamEnd",
        itu_filing_id            AS "ituFilingId",
        itu_constellation        AS "ituConstellation",
        itu_administration       AS "ituAdministration",
        itu_orbit_class          AS "ituOrbitClass",
        itu_altitude_km          AS "ituAltitudeKm",
        itu_planned_satellites   AS "ituPlannedSatellites",
        itu_frequency_bands      AS "ituFrequencyBands",
        itu_status               AS "ituStatus"
      FROM fn_list_launch_manifest(
        ${opts.horizonDays ?? 30}::int,
        ${opts.limit ?? 30}::int
      )
    `);
    return results.rows;
  }

  // ← absorbed from cortices/queries/orbit-regime.ts (stub)
  async getLaunchEpochWeather(
    _opts: {
      operatorCountryName?: string;
      operatorCountryId?: string | number;
      orbitRegime?: string;
      limit?: number;
    } = {},
  ): Promise<LaunchEpochWeatherRow[]> {
    return [];
  }
}

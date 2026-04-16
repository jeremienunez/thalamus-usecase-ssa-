import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export class SatelliteAuditRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /** Per-regime data quality audit. */
  async auditDataCompleteness(
    opts: { orbitRegime?: string; limit?: number } = {},
  ): Promise<
    Array<{
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
    }>
  > {
    const limit = opts.limit ?? 20;
    const regimeFilter = opts.orbitRegime
      ? sql`AND orr.name = ${opts.orbitRegime}`
      : sql``;

    const results = await this.db.execute(sql`
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

    type AuditRow = {
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
    };

    return (results.rows as unknown as AuditRow[]).map((r) => ({
      ...r,
      regimeId: r.regimeId == null ? null : String(r.regimeId),
    }));
  }

  /** Classification anomaly flags. */
  async auditClassification(
    opts: { limit?: number } = {},
  ): Promise<
    Array<{
      satelliteId: string;
      satelliteName: string;
      operatorName: string | null;
      platformClass: string | null;
      classificationTier: string | null;
      launchYear: number | null;
      massKg: number | null;
      flag: string;
      details: string;
    }>
  > {
    const limit = opts.limit ?? 50;

    const results = await this.db.execute(sql`
      WITH base AS (
        SELECT
          s.id,
          s.name,
          s.classification_tier,
          s.launch_year,
          s.mass_kg,
          s.mission_age,
          s.is_experimental,
          s.rating,
          op.name AS operator_name,
          pc.name AS platform_class
        FROM satellite s
        LEFT JOIN operator op ON op.id = s.operator_id
        LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
      ),
      missing_tier AS (
        SELECT id, name, operator_name, platform_class, classification_tier, launch_year, mass_kg,
          'missing_tier'::text AS flag,
          'classification_tier is NULL'::text AS details
        FROM base WHERE classification_tier IS NULL
      ),
      eo_mass_outlier AS (
        SELECT id, name, operator_name, platform_class, classification_tier, launch_year, mass_kg,
          'eo_mass_outlier'::text AS flag,
          ('EO satellite mass ' || mass_kg::int || 'kg exceeds 5000kg threshold')::text AS details
        FROM base
        WHERE mass_kg IS NOT NULL AND mass_kg > 5000 AND platform_class = 'earth_observation'
      ),
      temporal_impossible AS (
        SELECT id, name, operator_name, platform_class, classification_tier, launch_year, mass_kg,
          'temporal_impossible'::text AS flag,
          ('launch_year=' || launch_year || ' but mission_age=' || mission_age::numeric(6,2))::text AS details
        FROM base
        WHERE launch_year IS NOT NULL AND launch_year < 1990
          AND mission_age IS NOT NULL AND mission_age < 5
      ),
      experimental_high_rating AS (
        SELECT id, name, operator_name, platform_class, classification_tier, launch_year, mass_kg,
          'experimental_high_rating'::text AS flag,
          ('is_experimental=TRUE but rating=' || rating::numeric(4,2))::text AS details
        FROM base
        WHERE is_experimental IS TRUE AND rating IS NOT NULL AND rating > 0.9
      ),
      unioned AS (
        SELECT * FROM missing_tier
        UNION ALL SELECT * FROM eo_mass_outlier
        UNION ALL SELECT * FROM temporal_impossible
        UNION ALL SELECT * FROM experimental_high_rating
      )
      SELECT
        id::text AS "satelliteId",
        name AS "satelliteName",
        operator_name AS "operatorName",
        platform_class AS "platformClass",
        classification_tier AS "classificationTier",
        launch_year AS "launchYear",
        mass_kg AS "massKg",
        flag,
        details
      FROM unioned
      ORDER BY flag, "satelliteName"
      LIMIT ${limit}
    `);

    type ClassRow = {
      satelliteId: string;
      satelliteName: string;
      operatorName: string | null;
      platformClass: string | null;
      classificationTier: string | null;
      launchYear: number | null;
      massKg: number | null;
      flag: string;
      details: string;
    };

    return (results.rows as unknown as ClassRow[]).map((r) => ({
      ...r,
      satelliteId: String(r.satelliteId),
    }));
  }

  /** Apogee / orbit-manoeuvre news + satellite TLE context. */
  async listApogeeHistory(
    opts: {
      noradId?: string | number;
      windowDays?: number;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      kind: "news" | "satellite";
      title: string;
      summary: string | null;
      url: string | null;
      publishedAt: string | null;
      noradId: number | null;
      meanMotion: number | null;
      inclination: number | null;
      eccentricity: number | null;
    }>
  > {
    type ApogeeRow = {
      kind: "news" | "satellite";
      title: string;
      summary: string | null;
      url: string | null;
      publishedAt: string | null;
      noradId: number | null;
      meanMotion: number | null;
      inclination: number | null;
      eccentricity: number | null;
    };

    const perBranchLimit = Math.max(3, Math.ceil((opts.limit ?? 15) / 2));
    const totalLimit = opts.limit ?? 15;
    const norad = opts.noradId != null ? String(opts.noradId) : null;

    const newsRows = await this.db.execute(sql`
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
      ? await this.db.execute(sql`
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
      ...(newsRows.rows as unknown as ApogeeRow[]),
      ...(satRows.rows as unknown as ApogeeRow[]),
    ].slice(0, totalLimit);

    return combined;
  }
}

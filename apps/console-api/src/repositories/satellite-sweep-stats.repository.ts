import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export class SatelliteSweepStatsRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /** Aggregated stats per operator-country for nano-sweep audit. */
  async getOperatorCountrySweepStats(): Promise<
    Array<{
      operatorCountryId: bigint;
      operatorCountryName: string;
      orbitRegimeName: string;
      satelliteCount: number;
      missingPayloads: number;
      missingOrbitRegime: number;
      missingLaunchYear: number;
      missingMass: number;
      hasDoctrine: boolean;
      avgMass: number | null;
      topPayloads: string[];
      sampleSatellites: Array<{
        name: string;
        massKg: number;
        launchYear: number | null;
      }>;
    }>
  > {
    const rows = await this.db.execute<{
      operator_country_id: string;
      operator_country_name: string;
      orbit_regime_name: string;
      satellite_count: number;
      missing_payloads: number;
      missing_orbit_regime: number;
      missing_launch_year: number;
      missing_mass: number;
      has_doctrine: boolean;
      avg_mass: number | null;
      top_payloads: string[];
      sample_satellites: Array<{
        name: string;
        massKg: number;
        launchYear: number | null;
      }>;
    }>(sql`
      WITH operator_country_stats AS (
        SELECT
          oc.id::text AS operator_country_id,
          oc.name AS operator_country_name,
          reg.name AS orbit_regime_name,
          count(s.id)::int AS satellite_count,
          count(s.id) FILTER (
            WHERE NOT EXISTS (
              SELECT 1
              FROM satellite_payload sp
              WHERE sp.satellite_id = s.id
            )
          )::int AS missing_payloads,
          count(s.id) FILTER (
            WHERE s.g_orbit_regime_description IS NULL
              OR s.g_orbit_regime_description = ''
          )::int AS missing_orbit_regime,
          count(s.id) FILTER (WHERE s.launch_year IS NULL)::int AS missing_launch_year,
          count(s.id) FILTER (
            WHERE s.mass_kg = 0 OR s.mass_kg IS NULL
          )::int AS missing_mass,
          (oc.doctrine IS NOT NULL) AS has_doctrine,
          round(avg(s.mass_kg) FILTER (WHERE s.mass_kg > 0))::real AS avg_mass
        FROM operator_country oc
        JOIN orbit_regime reg ON reg.id = oc.orbit_regime_id
        LEFT JOIN satellite s ON s.operator_country_id = oc.id
        GROUP BY oc.id, oc.name, reg.name, oc.doctrine
        HAVING count(s.id) > 0
      ),
      ranked_payloads AS (
        SELECT
          s.operator_country_id::text AS operator_country_id,
          p.name,
          count(*)::int AS payload_count,
          row_number() OVER (
            PARTITION BY s.operator_country_id
            ORDER BY count(*) DESC, p.name ASC
          ) AS rank
        FROM satellite_payload sp
        JOIN payload p ON p.id = sp.payload_id
        JOIN satellite s ON s.id = sp.satellite_id
        GROUP BY s.operator_country_id, p.name
      ),
      top_payloads AS (
        SELECT
          operator_country_id,
          array_agg(name ORDER BY payload_count DESC, name ASC) AS top_payloads
        FROM ranked_payloads
        WHERE rank <= 5
        GROUP BY operator_country_id
      ),
      ranked_samples AS (
        SELECT
          s.operator_country_id::text AS operator_country_id,
          s.name,
          s.mass_kg,
          s.launch_year,
          row_number() OVER (
            PARTITION BY s.operator_country_id
            ORDER BY s.mass_kg DESC, s.name ASC
          ) AS rank
        FROM satellite s
        WHERE s.mass_kg > 0
      ),
      sample_satellites AS (
        SELECT
          operator_country_id,
          jsonb_agg(
            jsonb_build_object(
              'name', name,
              'massKg', mass_kg,
              'launchYear', launch_year
            )
            ORDER BY mass_kg DESC, name ASC
          ) AS sample_satellites
        FROM ranked_samples
        WHERE rank <= 3
        GROUP BY operator_country_id
      )
      SELECT
        ocs.operator_country_id,
        ocs.operator_country_name,
        ocs.orbit_regime_name,
        ocs.satellite_count,
        ocs.missing_payloads,
        ocs.missing_orbit_regime,
        ocs.missing_launch_year,
        ocs.missing_mass,
        ocs.has_doctrine,
        ocs.avg_mass,
        COALESCE(tp.top_payloads, ARRAY[]::text[]) AS top_payloads,
        COALESCE(ss.sample_satellites, '[]'::jsonb) AS sample_satellites
      FROM operator_country_stats ocs
      LEFT JOIN top_payloads tp
        ON tp.operator_country_id = ocs.operator_country_id
      LEFT JOIN sample_satellites ss
        ON ss.operator_country_id = ocs.operator_country_id
      ORDER BY ocs.satellite_count DESC
    `);

    return rows.rows.map((row) => ({
      operatorCountryId: BigInt(row.operator_country_id),
      operatorCountryName: row.operator_country_name,
      orbitRegimeName: row.orbit_regime_name,
      satelliteCount: row.satellite_count,
      missingPayloads: row.missing_payloads,
      missingOrbitRegime: row.missing_orbit_regime,
      missingLaunchYear: row.missing_launch_year,
      missingMass: row.missing_mass,
      hasDoctrine: row.has_doctrine,
      avgMass: row.avg_mass,
      topPayloads: row.top_payloads ?? [],
      sampleSatellites: row.sample_satellites ?? [],
    }));
  }
}

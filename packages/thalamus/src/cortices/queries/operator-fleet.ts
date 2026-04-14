import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryOperatorFleet — aggregate fleet composition per operator.
 *
 * Returns satellite counts, average fleet age, and a jsonb breakdown of regime /
 * platform / bus mix per operator. `userId` is accepted for forward-compat but
 * ignored in live DB (no user→fleet link table yet).
 */

export interface OperatorFleetRow {
  operatorId: number;
  operatorName: string;
  country: string | null;
  satelliteCount: number;
  avgAgeYears: number | null;
  regimeMix: Record<string, number>;
  platformMix: Record<string, number>;
  busMix: Record<string, number>;
}

export async function queryOperatorFleet(
  db: Database,
  opts: {
    operatorId?: string | number | bigint;
    userId?: string | number | bigint;
    limit?: number;
  } = {},
): Promise<OperatorFleetRow[]> {
  const opFilter = opts.operatorId
    ? sql`WHERE op.id = ${BigInt(opts.operatorId as string | number)}`
    : sql``;

  const results = await db.execute(sql`
    WITH base AS (
      SELECT
        op.id AS operator_id,
        op.name AS operator_name,
        oc.name AS country,
        s.id AS sat_id,
        s.launch_year,
        orr.name AS regime,
        pc.name AS platform,
        sb.name AS bus
      FROM operator op
      LEFT JOIN satellite s          ON s.operator_id         = op.id
      LEFT JOIN operator_country oc  ON oc.id                 = s.operator_country_id
      LEFT JOIN orbit_regime orr     ON orr.id                = oc.orbit_regime_id
      LEFT JOIN platform_class pc    ON pc.id                 = s.platform_class_id
      LEFT JOIN satellite_bus sb     ON sb.id                 = s.satellite_bus_id
      ${opFilter}
    ),
    mix AS (
      SELECT
        operator_id,
        operator_name,
        (array_agg(country) FILTER (WHERE country IS NOT NULL))[1] AS country,
        count(sat_id)::int AS satellite_count,
        (extract(year from now())::int - avg(launch_year))::real AS avg_age_years,
        COALESCE(
          jsonb_object_agg(regime, regime_count)
            FILTER (WHERE regime IS NOT NULL),
          '{}'::jsonb
        ) AS regime_mix,
        COALESCE(
          jsonb_object_agg(platform, platform_count)
            FILTER (WHERE platform IS NOT NULL),
          '{}'::jsonb
        ) AS platform_mix,
        COALESCE(
          jsonb_object_agg(bus, bus_count)
            FILTER (WHERE bus IS NOT NULL),
          '{}'::jsonb
        ) AS bus_mix
      FROM (
        SELECT
          operator_id, operator_name, country, sat_id, launch_year,
          regime, count(*) OVER (PARTITION BY operator_id, regime) AS regime_count,
          platform, count(*) OVER (PARTITION BY operator_id, platform) AS platform_count,
          bus, count(*) OVER (PARTITION BY operator_id, bus) AS bus_count
        FROM base
      ) d
      GROUP BY operator_id, operator_name
    )
    SELECT
      operator_id::int AS "operatorId",
      operator_name AS "operatorName",
      country,
      satellite_count AS "satelliteCount",
      avg_age_years AS "avgAgeYears",
      regime_mix AS "regimeMix",
      platform_mix AS "platformMix",
      bus_mix AS "busMix"
    FROM mix
    WHERE satellite_count > 0
    ORDER BY satellite_count DESC
    LIMIT ${opts.limit ?? 10}
  `);

  return results.rows as unknown as OperatorFleetRow[];
}

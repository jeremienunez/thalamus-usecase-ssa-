/**
 * Shared SQL builder for operator fleet rollups.
 *
 * Backs both:
 *   - FleetAnalysisRepository.analyzeOperatorFleet (HTTP /api/fleet, N rows)
 *   - SatelliteFleetRepository.getOperatorFleetSnapshot (sim, 1 row)
 *
 * Emits the canonical rollup shape:
 *   regimeMix:   Array<{ regime: string;   count: number }>   top-N desc
 *   platformMix: Array<{ platform: string; count: number }>   top-N desc
 *   busMix:      Array<{ bus: string;      count: number }>   top-N desc
 *   avgLaunchYear: number | null        (raw year; callers derive age if needed)
 *
 * Sim adapter drops busMix; HTTP transformer passes all three through.
 */

import { sql, type SQL } from "drizzle-orm";

export interface OperatorFleetRollupOpts {
  /** Filter to a single operator id (sim flow). */
  operatorId?: bigint | null;
  /** Max operators to return. Ignored when operatorId is pinned to one. */
  limit?: number;
  /** Top-N cutoff per mix array. */
  topN?: number;
}

export function operatorFleetRollupSql(opts: OperatorFleetRollupOpts = {}): SQL {
  const { operatorId = null, limit = 10, topN = 5 } = opts;

  return sql`
    WITH fleet AS (
      SELECT
        op.id           AS operator_id,
        op.name         AS operator_name,
        oc.name         AS country,
        s.id            AS sat_id,
        s.launch_year,
        orr.name        AS regime_name,
        pc.name         AS platform_name,
        sb.name         AS bus_name
      FROM operator op
      LEFT JOIN satellite s          ON s.operator_id         = op.id
      LEFT JOIN operator_country oc  ON oc.id                 = s.operator_country_id
      LEFT JOIN orbit_regime orr     ON orr.id                = oc.orbit_regime_id
      LEFT JOIN platform_class pc    ON pc.id                 = s.platform_class_id
      LEFT JOIN satellite_bus sb     ON sb.id                 = s.satellite_bus_id
      WHERE (${operatorId}::bigint IS NULL OR op.id = ${operatorId}::bigint)
    ),
    operators AS (
      SELECT
        operator_id,
        operator_name,
        (array_agg(country) FILTER (WHERE country IS NOT NULL))[1] AS country,
        count(sat_id)::int                                         AS satellite_count,
        avg(launch_year)::int                                      AS avg_launch_year
      FROM fleet
      GROUP BY operator_id, operator_name
    )
    SELECT
      o.operator_id::int                                           AS "operatorId",
      o.operator_name                                              AS "operatorName",
      o.country,
      o.satellite_count                                            AS "satelliteCount",
      o.avg_launch_year                                            AS "avgLaunchYear",
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('regime', regime_name, 'count', c))
           FROM (SELECT regime_name, count(*)::int AS c
                   FROM fleet f
                  WHERE f.operator_id = o.operator_id
                    AND regime_name IS NOT NULL
                  GROUP BY regime_name
                  ORDER BY c DESC
                  LIMIT ${topN}) r),
        '[]'::jsonb
      )                                                            AS "regimeMix",
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('platform', platform_name, 'count', c))
           FROM (SELECT platform_name, count(*)::int AS c
                   FROM fleet f
                  WHERE f.operator_id = o.operator_id
                    AND platform_name IS NOT NULL
                  GROUP BY platform_name
                  ORDER BY c DESC
                  LIMIT ${topN}) p),
        '[]'::jsonb
      )                                                            AS "platformMix",
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('bus', bus_name, 'count', c))
           FROM (SELECT bus_name, count(*)::int AS c
                   FROM fleet f
                  WHERE f.operator_id = o.operator_id
                    AND bus_name IS NOT NULL
                  GROUP BY bus_name
                  ORDER BY c DESC
                  LIMIT ${topN}) b),
        '[]'::jsonb
      )                                                            AS "busMix"
    FROM operators o
    WHERE o.satellite_count > 0
    ORDER BY o.satellite_count DESC
    LIMIT ${limit}
  `;
}

/** Row shape returned by operatorFleetRollupSql. Shared between repos. */
export type OperatorFleetRollupRow = {
  operatorId: number;
  operatorName: string;
  country: string | null;
  satelliteCount: number;
  avgLaunchYear: number | null;
  regimeMix: Array<{ regime: string; count: number }>;
  platformMix: Array<{ platform: string; count: number }>;
  busMix: Array<{ bus: string; count: number }>;
};

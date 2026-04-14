/**
 * SQL helpers — User Fleet mission windows.
 *
 * Cross-reference the mission operator's fleet (ground-station tracked
 * satellites) with safe_mission_window(). Groups by urgency:
 * operate_now, deorbit_soon, hold, urgent.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

export interface UserFleetWindowRow {
  phase: string;
  satellites: unknown;
  count: number;
}

export async function queryUserFleetWindows(
  db: Database,
  opts: { userId: string | number },
): Promise<UserFleetWindowRow[]> {
  const userId = BigInt(opts.userId);

  const results = await db.execute(sql`
    WITH fleet_satellites AS (
      SELECT s.id, s.name, s.launch_cost, s.launch_year,
        oc.name as operator_country, orr.name as orbit_regime,
        s.k_multiplier
      FROM fleet f
      JOIN satellite s ON s.id = f.satellite_id
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
      WHERE f.user_id = ${userId}
        AND f.status = 'in_fleet'
        AND s.launch_year IS NOT NULL
        AND s.launch_year > 1957
        AND s.k_multiplier IS NOT NULL
    ),
    with_window AS (
      SELECT fs.*,
        (mw.result->>'current_phase') as current_phase,
        (mw.result->>'nominal_life_years')::real as nominal_life_years,
        (mw.result->>'current_age_years')::real as current_age_years,
        GREATEST(0, (mw.result->>'nominal_life_years')::real
          - COALESCE((mw.result->>'current_age_years')::real, 0)) as years_to_eol,
        CASE
          WHEN (mw.result->>'current_phase') = 'nominal' THEN 'operate_now'
          WHEN (mw.result->>'current_phase') = 'decommission' THEN 'urgent'
          WHEN (mw.result->>'current_phase') = 'extended'
            AND GREATEST(0, (mw.result->>'nominal_life_years')::real
              - COALESCE((mw.result->>'current_age_years')::real, 0)) <= 2
            THEN 'deorbit_soon'
          ELSE 'hold'
        END as phase_bucket
      FROM fleet_satellites fs
      LEFT JOIN LATERAL (SELECT safe_mission_window(fs.id) as result) mw ON true
      WHERE (mw.result->>'current_phase') IS NOT NULL
    )
    SELECT phase_bucket as phase,
      json_agg(json_build_object(
        'id', id::text, 'name', name, 'launchCost', launch_cost,
        'launchYear', launch_year, 'operatorCountry', operator_country,
        'orbitRegime', orbit_regime, 'currentPhase', current_phase,
        'nominalLifeYears', nominal_life_years, 'yearsToEol', years_to_eol,
        'currentAgeYears', current_age_years
      ) ORDER BY years_to_eol ASC NULLS LAST) as satellites,
      count(*)::int as count
    FROM with_window
    GROUP BY phase_bucket
    ORDER BY
      CASE phase_bucket
        WHEN 'urgent' THEN 1 WHEN 'operate_now' THEN 2
        WHEN 'deorbit_soon' THEN 3 WHEN 'hold' THEN 4
      END
  `);

  return results.rows as unknown as UserFleetWindowRow[];
}

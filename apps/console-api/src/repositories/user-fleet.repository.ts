import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export class UserFleetRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /** Fleet mission windows grouped by urgency phase. */ // ← absorbed from cortices/queries/user-fleet.ts
  async listFleetWindows(opts: {
    userId: string | number;
  }): Promise<
    { phase: string; satellites: unknown; count: number }[]
  > {
    const userId = BigInt(opts.userId);

    const results = await this.db.execute<{
      phase: string;
      satellites: unknown;
      count: number;
    }>(sql`
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
    return results.rows;
  }

  /** User mission portfolio: fleet + watchlist aggregation. */ // ← absorbed from cortices/queries/user-mission-portfolio.ts
  async getMissionPortfolio(opts: {
    userId: string | number;
  }): Promise<
    { section: string; data: Record<string, unknown> }[]
  > {
    const userId = BigInt(opts.userId);

    const results = await this.db.execute<{
      section: string;
      data: Record<string, unknown>;
    }>(sql`
      WITH user_satellites AS (
        SELECT s.id, s.name, s.launch_cost, s.launch_year,
          oc.name as operator_country_name, orr.name as orbit_regime_name,
          s.classification_tier, s.k_multiplier,
          sb.name as bus_name, sb.id as bus_id,
          pc.name as platform_class_name,
          'fleet' as source
        FROM fleet f
        JOIN satellite s ON s.id = f.satellite_id
        LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
        LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
        LEFT JOIN satellite_bus sb ON sb.id = s.satellite_bus_id
        LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
        WHERE f.user_id = ${userId}
          AND f.status = 'in_fleet'
        UNION ALL
        SELECT s.id, s.name, s.launch_cost, s.launch_year,
          oc.name as operator_country_name, orr.name as orbit_regime_name,
          s.classification_tier, s.k_multiplier,
          sb.name as bus_name, sb.id as bus_id,
          pc.name as platform_class_name,
          'watchlist' as source
        FROM watchlist wl
        JOIN satellite s ON s.id = wl.satellite_id
        LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
        LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
        LEFT JOIN satellite_bus sb ON sb.id = s.satellite_bus_id
        LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
        WHERE wl.user_id = ${userId}
      ),
      country_stats AS (
        SELECT json_agg(json_build_object(
          'operatorCountry', operator_country_name, 'count', cnt,
          'pct', round(cnt * 100.0 / total, 1), 'avgLaunchCost', avg_cost
        ) ORDER BY cnt DESC) as data
        FROM (
          SELECT operator_country_name, count(*)::int as cnt,
            avg(launch_cost)::numeric(8,2) as avg_cost,
            (SELECT count(*) FROM user_satellites) as total
          FROM user_satellites GROUP BY operator_country_name
        ) sub
      ),
      platform_stats AS (
        SELECT json_agg(json_build_object(
          'platformClass', platform_class_name, 'count', cnt,
          'pct', round(cnt * 100.0 / total, 1)
        ) ORDER BY cnt DESC) as data
        FROM (
          SELECT platform_class_name, count(*)::int as cnt,
            (SELECT count(*) FROM user_satellites) as total
          FROM user_satellites WHERE platform_class_name IS NOT NULL GROUP BY platform_class_name
        ) sub
      ),
      bus_stats AS (
        SELECT json_agg(json_build_object(
          'busName', bus_name, 'busId', bus_id, 'count', cnt
        ) ORDER BY cnt DESC) as data
        FROM (
          SELECT bus_name, bus_id, count(*)::int as cnt
          FROM user_satellites WHERE bus_name IS NOT NULL
          GROUP BY bus_name, bus_id ORDER BY cnt DESC LIMIT 10
        ) sub
      ),
      tier_stats AS (
        SELECT json_agg(json_build_object(
          'tier', tier, 'count', cnt, 'avgLaunchCost', avg_cost
        ) ORDER BY avg_cost DESC) as data
        FROM (
          SELECT COALESCE(classification_tier, 'unclassified') as tier,
            count(*)::int as cnt, avg(launch_cost)::numeric(8,2) as avg_cost
          FROM user_satellites GROUP BY classification_tier
        ) sub
      ),
      summary AS (
        SELECT json_build_object(
          'totalSatellites', (SELECT count(*) FROM user_satellites),
          'fleetSatellites', (SELECT count(*) FROM user_satellites WHERE source = 'fleet'),
          'watchlistSatellites', (SELECT count(*) FROM user_satellites WHERE source = 'watchlist'),
          'totalValue', (SELECT sum(launch_cost) FROM user_satellites WHERE source = 'fleet'),
          'avgLaunchCost', (SELECT avg(launch_cost)::numeric(8,2) FROM user_satellites),
          'operatorCountryCount', (SELECT count(DISTINCT operator_country_name) FROM user_satellites),
          'busCount', (SELECT count(DISTINCT bus_id) FROM user_satellites WHERE bus_id IS NOT NULL)
        ) as data
      )
      SELECT 'summary' as section, data FROM summary
      UNION ALL SELECT 'operator_countries' as section, data FROM country_stats
      UNION ALL SELECT 'platform_classes' as section, data FROM platform_stats
      UNION ALL SELECT 'buses' as section, data FROM bus_stats
      UNION ALL SELECT 'tiers' as section, data FROM tier_stats
    `);
    return results.rows;
  }
}

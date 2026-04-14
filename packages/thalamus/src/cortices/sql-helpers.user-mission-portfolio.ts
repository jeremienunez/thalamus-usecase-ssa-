/**
 * SQL helpers — User Mission Portfolio analysis.
 *
 * Fleet + watchlist aggregation for the mission operator:
 * operator-country / platform-class / bus / regime stats.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

export interface UserMissionPortfolioRow {
  section: string;
  data: Record<string, unknown>;
}

export async function queryUserMissionPortfolio(
  db: Database,
  opts: { userId: string | number },
): Promise<UserMissionPortfolioRow[]> {
  const userId = BigInt(opts.userId);

  const results = await db.execute(sql`
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

  return results.rows as unknown as UserMissionPortfolioRow[];
}

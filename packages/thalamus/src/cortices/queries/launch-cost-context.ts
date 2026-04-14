/**
 * SQL helpers — Launch Cost Context.
 *
 * Satellite + operator-country doctrine + launch-epoch space weather
 * + manifest/market liquidity signals. Feeds the Launch-Cost cortex.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

export interface SatelliteLaunchCostContextRow {
  id: string;
  name: string;
  launchCost: number | null;
  launchYear: number | null;
  operatorCountryName: string;
  orbitRegimeName: string;
  platformClass: string | null;
  kMultiplier: number | null;
  busName: string | null;
  manifestSourceCount: number;
  inclinationDeg: number | null;
  altitudeKm: number | null;
  eccentricity: number | null;
  regimeType: string | null;
  slotCapacityMax: string | null;
  solarFluxZone: string | null;
  radiationZone: string | null;
  solarFluxIndex: number | null;
  kpIndex: number | null;
  radiationIndex: number | null;
}

export async function querySatelliteLaunchCostContext(
  db: Database,
  opts: {
    orbitRegime?: string;
    minLaunchCost?: number;
    maxLaunchCost?: number;
    limit?: number;
  },
): Promise<SatelliteLaunchCostContextRow[]> {
  const limit = opts.limit ?? 50;
  const regimeFilter = opts.orbitRegime
    ? sql`AND orr.name = ${opts.orbitRegime}`
    : sql``;
  let costFilter = sql``;
  if (opts.minLaunchCost)
    costFilter = sql`${costFilter} AND s.launch_cost >= ${opts.minLaunchCost}`;
  if (opts.maxLaunchCost)
    costFilter = sql`${costFilter} AND s.launch_cost <= ${opts.maxLaunchCost}`;

  // Placeholder signature — this is a proxy query shape kept compatible
  // with the legacy price-context helper. Real launch-cost sourcing is
  // wired by the launch-market fetcher; this helper joins known
  // reference data so the cortex has a single row per satellite.
  const results = await db.execute(sql`
    SELECT
      s.id::text, s.name, s.launch_cost as "launchCost",
      s.launch_year as "launchYear",
      oc.name as "operatorCountryName",
      orr.name as "orbitRegimeName",
      pc.name as "platformClass",
      s.k_multiplier as "kMultiplier",
      sb.name as "busName",
      (oc.doctrine->'regime'->'orbit'->>'inclination_deg')::real as "inclinationDeg",
      (oc.doctrine->'regime'->'orbit'->>'altitude_km')::real as "altitudeKm",
      (oc.doctrine->'regime'->'orbit'->>'eccentricity')::real as "eccentricity",
      oc.doctrine->'regime'->'orbit'->>'regime_type' as "regimeType",
      oc.doctrine->>'slot_capacity_max' as "slotCapacityMax",
      oc.doctrine->'regime'->'environment'->'classification'->>'solar_flux_zone' as "solarFluxZone",
      oc.doctrine->'regime'->'environment'->'classification'->>'radiation_zone' as "radiationZone",
      le.solar_flux_index as "solarFluxIndex",
      le.kp_index as "kpIndex",
      le.radiation_index as "radiationIndex",
      COALESCE(manifest.src_count, 0)::int as "manifestSourceCount"
    FROM satellite s
    JOIN operator_country oc ON oc.id = s.operator_country_id
    JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
    LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
    LEFT JOIN satellite_bus sb ON sb.id = s.satellite_bus_id
    LEFT JOIN launch_epoch le ON le.operator_country_id = oc.id AND le.year = s.launch_year
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT si.source_id)::int as src_count
      FROM source_item si
      JOIN source src ON src.id = si.source_id
      WHERE src.kind = 'rss'
        AND src.category = 'LAUNCH_MARKET'
        AND length(split_part(s.name, ' ', 2)) > 2
        AND si.title ILIKE '%' || split_part(s.name, ' ', 2) || '%'
        AND si.fetched_at > now() - interval '30 days'
    ) manifest ON true
    WHERE s.launch_cost IS NOT NULL AND s.launch_cost > 5
      ${regimeFilter}
      ${costFilter}
    ORDER BY COALESCE(manifest.src_count, 0) DESC, s.launch_cost ASC
    LIMIT ${limit}
  `);

  return results.rows as unknown as SatelliteLaunchCostContextRow[];
}

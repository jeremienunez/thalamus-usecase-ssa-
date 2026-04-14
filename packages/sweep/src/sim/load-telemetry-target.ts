/**
 * Load the TelemetryTarget for a sim_run — shared by both turn-runners.
 *
 * Reads `sim_run.seed_applied.telemetryTargetSatelliteId`. If present,
 * fetches the satellite's name, NORAD id, regime, launch year, and bus
 * archetype, then flattens the `busDatasheetPrior` block from seed_applied.
 *
 * Returns `null` for non-telemetry swarms (UC1 / UC3) — buildContext is
 * free to treat absence as "this is an operator-behaviour fish".
 */

import { sql } from "drizzle-orm";
import type { Database, SeedRefs } from "@interview/db-schema";
import type { TelemetryTarget } from "./types";

export async function loadTelemetryTarget(
  db: Database,
  simRunId: number,
): Promise<TelemetryTarget | null> {
  // Read seed_applied — contains both the target id and the (possibly
  // perturbed) bus datasheet prior that the swarm launcher attached.
  const runRows = await db.execute(sql`
    SELECT seed_applied
    FROM sim_run
    WHERE id = ${BigInt(simRunId)}
    LIMIT 1
  `);
  const row = runRows.rows[0] as { seed_applied: SeedRefs } | undefined;
  if (!row) return null;
  const seed = row.seed_applied ?? {};
  const satelliteId = seed.telemetryTargetSatelliteId;
  if (satelliteId == null) return null;

  // Fetch satellite metadata for the prompt header.
  const satRows = await db.execute(sql`
    SELECT
      s.id::int                                       AS id,
      s.name                                          AS name,
      NULLIF(s.telemetry_summary->>'noradId','')::int AS norad_id,
      s.launch_year                                   AS launch_year,
      orr.name                                        AS regime,
      sb.name                                         AS bus_name
    FROM satellite s
    LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
    LEFT JOIN orbit_regime orr    ON orr.id = oc.orbit_regime_id
    LEFT JOIN satellite_bus sb    ON sb.id = s.satellite_bus_id
    WHERE s.id = ${BigInt(satelliteId)}
    LIMIT 1
  `);
  const sat = satRows.rows[0] as
    | {
        id: number;
        name: string;
        norad_id: number | null;
        launch_year: number | null;
        regime: string | null;
        bus_name: string | null;
      }
    | undefined;
  if (!sat) {
    // Target satellite missing — degrade gracefully rather than crashing
    // the turn. Fish will see `null` and report low confidence.
    return {
      satelliteId,
      satelliteName: `(unknown sat id=${satelliteId})`,
      noradId: null,
      regime: null,
      launchYear: null,
      busArchetype: seed.busDatasheetPrior?.busArchetype ?? null,
      busDatasheetPrior: seed.busDatasheetPrior?.scalars ?? null,
      sources: [],
    };
  }

  return {
    satelliteId: sat.id,
    satelliteName: sat.name,
    noradId: sat.norad_id,
    regime: sat.regime,
    launchYear: sat.launch_year,
    busArchetype: seed.busDatasheetPrior?.busArchetype ?? sat.bus_name,
    busDatasheetPrior: seed.busDatasheetPrior?.scalars ?? null,
    sources: [],
  };
}

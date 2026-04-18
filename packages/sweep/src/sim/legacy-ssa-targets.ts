/**
 * LegacySsaTurnTargetProvider — fallback SimTurnTargetProvider.
 *
 * Implements the port inside the sweep package using raw SQL. Used ONLY when
 * buildSweepContainer is called WITHOUT opts.sim.targets. The console-api
 * path injects SsaTurnTargetProvider (apps/console-api/src/agent/ssa/sim/targets.ts).
 *
 * Plan 2 lifecycle:
 *   - B.2: this file lands (replaces load-telemetry-target.ts + load-pc-target.ts).
 *   - Étape 4: deleted; container always requires the port.
 *
 * Returns a bag `{ telemetryTarget, pcEstimatorTarget }`. Both nullable.
 */

import { sql } from "drizzle-orm";
import type { Database, SeedRefs } from "@interview/db-schema";
import type {
  SimTurnTargetProvider,
} from "./ports";
import type { TelemetryTarget, PcEstimatorTarget } from "./types";

export class LegacySsaTurnTargetProvider implements SimTurnTargetProvider {
  constructor(private readonly db: Database) {}

  async loadTargets(args: {
    simRunId: number;
    seedHints: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const [telemetryTarget, pcEstimatorTarget] = await Promise.all([
      loadTelemetryTarget(this.db, args.simRunId),
      loadPcTarget(this.db, args.simRunId),
    ]);
    return { telemetryTarget, pcEstimatorTarget };
  }
}

async function loadTelemetryTarget(
  db: Database,
  simRunId: number,
): Promise<TelemetryTarget | null> {
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

async function loadPcTarget(
  db: Database,
  simRunId: number,
): Promise<PcEstimatorTarget | null> {
  const runRows = await db.execute(sql`
    SELECT seed_applied
    FROM sim_run
    WHERE id = ${BigInt(simRunId)}
    LIMIT 1
  `);
  const row = runRows.rows[0] as { seed_applied: SeedRefs } | undefined;
  if (!row) return null;
  const seed = row.seed_applied ?? {};
  const conjId = seed.pcEstimatorTarget;
  if (conjId == null) return null;

  const rows = await db.execute(sql`
    SELECT
      ce.id::int                                         AS id,
      ce.epoch                                           AS tca,
      ce.min_range_km                                    AS miss_km,
      ce.relative_velocity_kmps                          AS rel_v,
      ce.probability_of_collision                        AS current_pc,
      ce.hard_body_radius_m                              AS hbr,
      ce.combined_sigma_km                               AS combined_sigma,
      ce.primary_satellite_id::int                       AS p_id,
      ce.secondary_satellite_id::int                     AS s_id,
      sp.name                                            AS p_name,
      ss.name                                            AS s_name,
      NULLIF(sp.telemetry_summary->>'noradId','')::int   AS p_norad,
      NULLIF(ss.telemetry_summary->>'noradId','')::int   AS s_norad,
      spb.name                                           AS p_bus,
      ssb.name                                           AS s_bus
    FROM conjunction_event ce
    LEFT JOIN satellite sp      ON sp.id = ce.primary_satellite_id
    LEFT JOIN satellite ss      ON ss.id = ce.secondary_satellite_id
    LEFT JOIN satellite_bus spb ON spb.id = sp.satellite_bus_id
    LEFT JOIN satellite_bus ssb ON ssb.id = ss.satellite_bus_id
    WHERE ce.id = ${BigInt(conjId)}
    LIMIT 1
  `);
  const r = rows.rows[0] as
    | {
        id: number;
        tca: Date | string | null;
        miss_km: number | null;
        rel_v: number | null;
        current_pc: number | null;
        hbr: number | null;
        combined_sigma: number | null;
        p_id: number;
        s_id: number;
        p_name: string | null;
        s_name: string | null;
        p_norad: number | null;
        s_norad: number | null;
        p_bus: string | null;
        s_bus: string | null;
      }
    | undefined;
  if (!r) {
    return {
      conjunctionId: conjId,
      tca: null,
      missDistanceKm: null,
      relativeVelocityKmps: null,
      currentPc: null,
      hardBodyRadiusMeters: null,
      combinedSigmaKm: null,
      primary: { id: 0, name: `(unknown conj=${conjId})`, noradId: null, bus: null },
      secondary: { id: 0, name: "(unknown)", noradId: null, bus: null },
      assumptions: seed.pcAssumptions ?? null,
    };
  }
  return {
    conjunctionId: r.id,
    tca: r.tca ? new Date(r.tca as string | Date) : null,
    missDistanceKm: r.miss_km,
    relativeVelocityKmps: r.rel_v,
    currentPc: r.current_pc,
    hardBodyRadiusMeters: r.hbr,
    combinedSigmaKm: r.combined_sigma,
    primary: {
      id: r.p_id,
      name: r.p_name ?? `sat#${r.p_id}`,
      noradId: r.p_norad,
      bus: r.p_bus,
    },
    secondary: {
      id: r.s_id,
      name: r.s_name ?? `sat#${r.s_id}`,
      noradId: r.s_norad,
      bus: r.s_bus,
    },
    assumptions: seed.pcAssumptions ?? null,
  };
}

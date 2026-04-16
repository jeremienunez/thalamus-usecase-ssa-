/**
 * Load the PcEstimatorTarget for a sim_run — mirrors loadTelemetryTarget.
 *
 * Reads `sim_run.seed_applied.pcEstimatorTarget` (the conjunction_event.id).
 * Joins conjunction_event + both satellites + bus/mass metadata. Non-Pc swarms
 * return null so the turn-runners can treat absence as "this isn't a Pc fish".
 *
 * Defensive: if conjunction_event columns (covariance, mass) are NULL in the
 * seed catalog, we return null placeholders — the fish is expected to flag
 * `low-data` rather than invent values.
 */

import { sql } from "drizzle-orm";
import type { Database, SeedRefs } from "@interview/db-schema";

export interface PcEstimatorTarget {
  conjunctionId: number;
  tca: Date | null;
  missDistanceKm: number | null;
  relativeVelocityKmps: number | null;
  currentPc: number | null;
  hardBodyRadiusMeters: number | null;
  combinedSigmaKm: number | null;
  primary: {
    id: number;
    name: string;
    noradId: number | null;
    bus: string | null;
  };
  secondary: {
    id: number;
    name: string;
    noradId: number | null;
    bus: string | null;
  };
  /** Per-fish perturbation extracted from seed_applied.pcAssumptions. */
  assumptions: {
    hardBodyRadiusMeters: number;
    covarianceScale: "tight" | "nominal" | "loose";
  } | null;
}

export async function loadPcTarget(
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

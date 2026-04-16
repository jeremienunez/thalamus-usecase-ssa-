import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryConjunctionScreen — joins conjunction_event (SGP4-propagated close
 * approaches) to satellite + operator + orbit_regime for cortex-ready
 * findings. Events are seeded by `seedConjunctions` in db-schema.
 */

export interface ConjunctionScreenRow {
  conjunctionId: number;
  primarySatellite: string;
  primaryNoradId: number | null;
  secondarySatellite: string;
  secondaryNoradId: number | null;
  epoch: string;
  minRangeKm: number;
  relativeVelocityKmps: number | null;
  probabilityOfCollision: number | null;
  primarySigmaKm: number | null;
  secondarySigmaKm: number | null;
  combinedSigmaKm: number | null;
  hardBodyRadiusM: number | null;
  pcMethod: string | null;
  operatorPrimary: string | null;
  operatorSecondary: string | null;
  regime: string | null;
  primaryTleEpoch: string | null;
}

export async function queryConjunctionScreen(
  db: Database,
  opts: {
    windowHours?: number;
    primaryNoradId?: string | number;
    limit?: number;
  } = {},
): Promise<ConjunctionScreenRow[]> {
  const windowHours = opts.windowHours ?? 168;
  const noradFilter = opts.primaryNoradId
    ? sql`AND (p.telemetry_summary->>'noradId' = ${String(opts.primaryNoradId)}
               OR s.telemetry_summary->>'noradId' = ${String(opts.primaryNoradId)})`
    : sql``;

  const results = await db.execute(sql`
    SELECT
      ce.id::int AS "conjunctionId",
      p.name AS "primarySatellite",
      NULLIF(p.telemetry_summary->>'noradId','')::int AS "primaryNoradId",
      s.name AS "secondarySatellite",
      NULLIF(s.telemetry_summary->>'noradId','')::int AS "secondaryNoradId",
      ce.epoch::text AS "epoch",
      ce.min_range_km AS "minRangeKm",
      ce.relative_velocity_kmps AS "relativeVelocityKmps",
      ce.probability_of_collision AS "probabilityOfCollision",
      ce.primary_sigma_km AS "primarySigmaKm",
      ce.secondary_sigma_km AS "secondarySigmaKm",
      ce.combined_sigma_km AS "combinedSigmaKm",
      ce.hard_body_radius_m AS "hardBodyRadiusM",
      ce.pc_method AS "pcMethod",
      op_p.name AS "operatorPrimary",
      op_s.name AS "operatorSecondary",
      p.telemetry_summary->>'regime' AS "regime",
      p.telemetry_summary->>'tleEpoch' AS "primaryTleEpoch"
    FROM conjunction_event ce
    JOIN satellite p ON p.id = ce.primary_satellite_id
    JOIN satellite s ON s.id = ce.secondary_satellite_id
    LEFT JOIN operator op_p   ON op_p.id = p.operator_id
    LEFT JOIN operator op_s   ON op_s.id = s.operator_id
    WHERE ce.epoch BETWEEN now() AND now() + (${windowHours} || ' hours')::interval
      ${noradFilter}
    ORDER BY ce.probability_of_collision DESC NULLS LAST, ce.min_range_km ASC
    LIMIT ${opts.limit ?? 20}
  `);

  return results.rows as unknown as ConjunctionScreenRow[];
}

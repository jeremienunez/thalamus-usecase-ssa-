import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  ConjunctionRow,
  ConjunctionWithSatellitesRow,
  ScreenedConjunctionRow,
  KnnCandidateRow,
} from "../types/conjunction.types";

export type {
  ConjunctionRow,
  ConjunctionWithSatellitesRow,
  ScreenedConjunctionRow,
  KnnCandidateRow,
} from "../types/conjunction.types";

export class ConjunctionRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async listAboveMinPc(minPc: number): Promise<ConjunctionRow[]> {
    const rows = await this.db.execute<ConjunctionRow>(sql`
      SELECT
        ce.id::text                                         AS id,
        ce.primary_satellite_id::text                       AS primary_id,
        ce.secondary_satellite_id::text                     AS secondary_id,
        sp.name                                             AS primary_name,
        ss.name                                             AS secondary_name,
        sp.norad_id                                         AS primary_norad_id,
        ss.norad_id                                         AS secondary_norad_id,
        NULLIF(sp.telemetry_summary->>'meanMotion','')::float AS primary_mm,
        ce.epoch,
        ce.min_range_km,
        ce.relative_velocity_kmps,
        ce.probability_of_collision,
        ce.combined_sigma_km,
        ce.hard_body_radius_m,
        ce.pc_method,
        ce.computed_at
      FROM conjunction_event ce
      LEFT JOIN satellite sp ON sp.id = ce.primary_satellite_id
      LEFT JOIN satellite ss ON ss.id = ce.secondary_satellite_id
      WHERE COALESCE(ce.probability_of_collision, 0) >= ${minPc}
        AND ce.min_range_km > 0
        AND COALESCE(ce.relative_velocity_kmps, 0) > 0
      ORDER BY ce.probability_of_collision DESC NULLS LAST
      LIMIT 500
    `);
    return rows.rows;
  }

  // ── Cortex-consumed reads ──

  /** Screen conjunction events within a time window. */ // ← absorbed from cortices/queries/conjunction.ts
  async screenConjunctions(
    opts: {
      windowHours?: number;
      primaryNoradId?: string | number;
      limit?: number;
    } = {},
  ): Promise<ScreenedConjunctionRow[]> {
    const windowHours = opts.windowHours ?? 168;
    const noradFilter = opts.primaryNoradId
      ? sql`AND (p.norad_id = ${Number(opts.primaryNoradId)}
                 OR s.norad_id = ${Number(opts.primaryNoradId)})`
      : sql``;

    const results = await this.db.execute<ScreenedConjunctionRow>(sql`
      SELECT
        ce.id::int AS "conjunctionId",
        p.name AS "primarySatellite",
        p.norad_id AS "primaryNoradId",
        s.name AS "secondarySatellite",
        s.norad_id AS "secondaryNoradId",
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
        AND ce.min_range_km > 0
        AND COALESCE(ce.relative_velocity_kmps, 0) > 0
        ${noradFilter}
      ORDER BY ce.probability_of_collision DESC NULLS LAST, ce.min_range_km ASC
      LIMIT ${opts.limit ?? 20}
    `);

    return results.rows;
  }

  /** KNN candidate proposer using Voyage halfvec HNSW + altitude overlap.
   *  Wraps fn_conjunction_candidates_knn which sets hnsw.ef_search
   *  transaction-locally so the pool connection's session state is not
   *  polluted between calls. */
  async findKnnCandidates(opts: {
    targetNoradId: number;
    knnK?: number;
    limit?: number;
    marginKm?: number;
    objectClass?: string | null;
    excludeSameFamily?: boolean;
    efSearch?: number;
  }): Promise<KnnCandidateRow[]> {
    const rows = await this.db.execute<KnnCandidateRow>(sql`
      SELECT
        target_norad_id    AS "targetNoradId",
        target_name        AS "targetName",
        candidate_id       AS "candidateId",
        candidate_name     AS "candidateName",
        candidate_norad_id AS "candidateNoradId",
        candidate_class    AS "candidateClass",
        cos_distance       AS "cosDistance",
        apogee_km          AS "apogeeKm",
        perigee_km         AS "perigeeKm",
        inclination_deg    AS "inclinationDeg",
        overlap_km         AS "overlapKm",
        regime
      FROM fn_conjunction_candidates_knn(
        ${opts.targetNoradId}::int,
        ${opts.knnK ?? 200}::int,
        ${opts.limit ?? 50}::int,
        ${opts.marginKm ?? 20}::real,
        ${opts.objectClass ?? null}::text,
        ${opts.excludeSameFamily ?? false}::boolean,
        ${opts.efSearch ?? 100}::int
      )
    `);
    return rows.rows;
  }

  /**
   * Full conjunction profile by id: event row + both satellites + both
   * buses + both operator ids. One query, one round-trip. Null when the
   * id doesn't exist.
   *
   * Consumers:
   *   - sim target composition (`services/sim-target.service.ts`)
   *   - sim pc-estimator swarm launcher (`services/sim-launch.service.ts`)
   *
   * Introduced: Plan 5 · 1.A.8 (absorbs the ad-hoc SQL previously in
   * `packages/sweep/src/sim/agent/ssa/sim/targets.ts::loadPcTarget` and
   * `packages/sweep/src/sim/agent/ssa/sim/swarms/pc.ts::loadConjunctionMeta`).
   */
  async findByIdWithSatellites(
    conjunctionId: bigint,
  ): Promise<ConjunctionWithSatellitesRow | null> {
    const rows = await this.db.execute<{
      id: string;
      tca: Date | string | null;
      miss_km: number | null;
      rel_v: number | null;
      current_pc: number | null;
      hbr: number | null;
      combined_sigma: number | null;
      p_id: string;
      s_id: string;
      p_name: string | null;
      s_name: string | null;
      p_norad: number | null;
      s_norad: number | null;
      p_bus: string | null;
      s_bus: string | null;
      p_op: string | null;
      s_op: string | null;
    }>(sql`
      SELECT
        ce.id::text                                         AS id,
        ce.epoch                                            AS tca,
        ce.min_range_km                                     AS miss_km,
        ce.relative_velocity_kmps                           AS rel_v,
        ce.probability_of_collision                         AS current_pc,
        ce.hard_body_radius_m                               AS hbr,
        ce.combined_sigma_km                                AS combined_sigma,
        ce.primary_satellite_id::text                       AS p_id,
        ce.secondary_satellite_id::text                     AS s_id,
        sp.name                                             AS p_name,
        ss.name                                             AS s_name,
        sp.norad_id                                         AS p_norad,
        ss.norad_id                                         AS s_norad,
        spb.name                                            AS p_bus,
        ssb.name                                            AS s_bus,
        sp.operator_id::text                                AS p_op,
        ss.operator_id::text                                AS s_op
      FROM conjunction_event ce
      LEFT JOIN satellite sp      ON sp.id = ce.primary_satellite_id
      LEFT JOIN satellite ss      ON ss.id = ce.secondary_satellite_id
      LEFT JOIN satellite_bus spb ON spb.id = sp.satellite_bus_id
      LEFT JOIN satellite_bus ssb ON ssb.id = ss.satellite_bus_id
      WHERE ce.id = ${conjunctionId}
      LIMIT 1
    `);
    const r = rows.rows[0];
    if (!r) return null;
    return {
      id: BigInt(r.id),
      epoch: r.tca ? new Date(r.tca as string | Date) : null,
      minRangeKm: r.miss_km,
      relativeVelocityKmps: r.rel_v,
      probabilityOfCollision: r.current_pc,
      hardBodyRadiusM: r.hbr,
      combinedSigmaKm: r.combined_sigma,
      primary: {
        id: BigInt(r.p_id),
        name: r.p_name,
        noradId: r.p_norad,
        busName: r.p_bus,
        operatorId: r.p_op ? BigInt(r.p_op) : null,
      },
      secondary: {
        id: BigInt(r.s_id),
        name: r.s_name,
        noradId: r.s_norad,
        busName: r.s_bus,
        operatorId: r.s_op ? BigInt(r.s_op) : null,
      },
    };
  }
}

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
      ? sql`AND (p.telemetry_summary->>'noradId' = ${String(opts.primaryNoradId)}
                 OR s.telemetry_summary->>'noradId' = ${String(opts.primaryNoradId)})`
      : sql``;

    const results = await this.db.execute<ScreenedConjunctionRow>(sql`
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

    return results.rows;
  }

  /** KNN candidate proposer using Voyage halfvec HNSW + altitude overlap. */ // ← absorbed from cortices/queries/conjunction-candidates.ts
  async findKnnCandidates(opts: {
    targetNoradId: number;
    knnK?: number;
    limit?: number;
    marginKm?: number;
    objectClass?: string | null;
    excludeSameFamily?: boolean;
    efSearch?: number;
  }): Promise<KnnCandidateRow[]> {
    const knnK = opts.knnK ?? 200;
    const limit = opts.limit ?? 50;
    const marginKm = opts.marginKm ?? 20;
    const efSearch = opts.efSearch ?? 100;

    const ef = Math.max(10, Math.min(1000, Math.floor(efSearch)));
    await this.db.execute(sql.raw(`SET hnsw.ef_search = ${ef}`));

    const rows = await this.db.execute<KnnCandidateRow>(sql`
      WITH target AS (
        SELECT
          id, name, norad_id, embedding,
          (metadata->>'apogeeKm')::numeric::float  AS apogee,
          (metadata->>'perigeeKm')::numeric::float AS perigee
        FROM satellite
        WHERE norad_id = ${opts.targetNoradId}
          AND embedding IS NOT NULL
        LIMIT 1
      ),
      knn AS (
        SELECT
          s.id, s.name, s.norad_id, s.object_class,
          (s.metadata->>'apogeeKm')::numeric::float         AS apogee,
          (s.metadata->>'perigeeKm')::numeric::float        AS perigee,
          (s.metadata->>'inclinationDeg')::numeric::float   AS inc,
          (s.embedding <=> t.embedding)::float              AS cos_distance
        FROM satellite s, target t
        WHERE s.id != t.id
          AND s.embedding IS NOT NULL
          ${opts.objectClass ? sql`AND s.object_class = ${opts.objectClass}` : sql``}
        ORDER BY s.embedding <=> t.embedding
        LIMIT ${knnK}
      )
      SELECT
        t.norad_id::int                     AS "targetNoradId",
        t.name                              AS "targetName",
        k.id::int                           AS "candidateId",
        k.name                              AS "candidateName",
        k.norad_id::int                     AS "candidateNoradId",
        k.object_class                      AS "candidateClass",
        k.cos_distance                      AS "cosDistance",
        k.apogee                            AS "apogeeKm",
        k.perigee                           AS "perigeeKm",
        k.inc                               AS "inclinationDeg",
        (LEAST(t.apogee, k.apogee) - GREATEST(t.perigee, k.perigee) + 2 * ${marginKm})::float AS "overlapKm",
        CASE
          WHEN (k.apogee + k.perigee) / 2 < 2000  THEN 'leo'
          WHEN (k.apogee + k.perigee) / 2 < 35000 THEN 'meo'
          WHEN (k.apogee + k.perigee) / 2 < 36500 THEN 'geo'
          WHEN k.apogee IS NOT NULL               THEN 'heo'
          ELSE 'unknown'
        END AS "regime"
      FROM knn k, target t
      WHERE k.apogee IS NOT NULL AND k.perigee IS NOT NULL
        AND t.apogee IS NOT NULL AND t.perigee IS NOT NULL
        AND (LEAST(t.apogee, k.apogee) - GREATEST(t.perigee, k.perigee) + 2 * ${marginKm}) > 0
        ${
          opts.excludeSameFamily
            ? sql`AND NOT (
                split_part(t.name, ' ', 1) = split_part(k.name, ' ', 1)
                AND t.name ~ '[A-Z]+-?[0-9]+$'
              )`
            : sql``
        }
      ORDER BY k.cos_distance ASC
      LIMIT ${limit}
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
        NULLIF(sp.telemetry_summary->>'noradId','')::int    AS p_norad,
        NULLIF(ss.telemetry_summary->>'noradId','')::int    AS s_norad,
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

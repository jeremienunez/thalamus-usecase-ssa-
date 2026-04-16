import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type ConjunctionRow = {
  id: string;
  primary_id: string;
  secondary_id: string;
  primary_name: string;
  secondary_name: string;
  primary_mm: number | null;
  epoch: Date | string;
  min_range_km: number;
  relative_velocity_kmps: number | null;
  probability_of_collision: number | null;
  combined_sigma_km: number | null;
  hard_body_radius_m: number | null;
  pc_method: string | null;
  computed_at: Date | string;
};

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
  ): Promise<
    {
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
    }[]
  > {
    const windowHours = opts.windowHours ?? 168;
    const noradFilter = opts.primaryNoradId
      ? sql`AND (p.telemetry_summary->>'noradId' = ${String(opts.primaryNoradId)}
                 OR s.telemetry_summary->>'noradId' = ${String(opts.primaryNoradId)})`
      : sql``;

    const results = await this.db.execute(sql`
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

    return results.rows as unknown as ReturnType<ConjunctionRepository["screenConjunctions"]> extends Promise<infer R> ? R : never;
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
  }): Promise<
    {
      targetNoradId: number;
      targetName: string;
      candidateId: number;
      candidateName: string;
      candidateNoradId: number | null;
      candidateClass: string | null;
      cosDistance: number;
      overlapKm: number;
      apogeeKm: number | null;
      perigeeKm: number | null;
      inclinationDeg: number | null;
      regime: "leo" | "meo" | "geo" | "heo" | "unknown";
    }[]
  > {
    const knnK = opts.knnK ?? 200;
    const limit = opts.limit ?? 50;
    const marginKm = opts.marginKm ?? 20;
    const efSearch = opts.efSearch ?? 100;

    const ef = Math.max(10, Math.min(1000, Math.floor(efSearch)));
    await this.db.execute(sql.raw(`SET hnsw.ef_search = ${ef}`));

    const rows = await this.db.execute(sql`
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

    return rows.rows as unknown as Awaited<ReturnType<ConjunctionRepository["findKnnCandidates"]>>;
  }
}

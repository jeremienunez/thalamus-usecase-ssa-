import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

/**
 * queryConjunctionCandidatesKnn — pre-narrow-phase candidate proposer.
 *
 * Combines two orthogonal signals:
 *   1. semantic proximity via Voyage halfvec(2048) HNSW on `satellite.embedding`
 *      — captures "same doctrine / same altitude band / same family" without
 *      any hand-written filter. Debris fields from a single ASAT event cluster
 *      tightly; constellation members cluster within 0.06 cos distance.
 *   2. radial-overlap pruning on apogee / perigee bands. A pair survives
 *      iff their altitude envelopes overlap within `marginKm`.
 *
 * Output is ordered by cosine distance (ascending). The narrow-phase SGP4
 * screener should only propagate the survivors — a factor of ~1000× reduction
 * vs the naive O(n²) universe (33k² = 543M → ~500 candidates per query).
 *
 * Requires `satellite.embedding` populated via `embed-catalog.ts` and the
 * HNSW index `satellite_embedding_hnsw`.
 */

export interface ConjunctionCandidateKnn {
  /** Target — the satellite we're screening against. */
  targetNoradId: number;
  targetName: string;
  /** Candidate neighbor. */
  candidateId: number;
  candidateName: string;
  candidateNoradId: number | null;
  candidateClass: string | null;
  /** Cosine distance in [0, 2]. Same-family constellation neighbors < 0.1. */
  cosDistance: number;
  /** Altitude envelope intersection (km). Negative = no overlap (pruned). */
  overlapKm: number;
  apogeeKm: number | null;
  perigeeKm: number | null;
  inclinationDeg: number | null;
  /** Regime bucket derived from mean altitude. */
  regime: "leo" | "meo" | "geo" | "heo" | "unknown";
}

export interface ConjunctionCandidatesKnnOpts {
  /** NORAD id of the target to screen against. */
  targetNoradId: number;
  /** How many KNN candidates to return before altitude filtering (default 200). */
  knnK?: number;
  /** Max candidates returned after altitude filter (default 50). */
  limit?: number;
  /** Radial overlap slack in km (default 20). */
  marginKm?: number;
  /** Restrict candidate class: "payload" | "rocket_stage" | "debris" | "unknown" | null. */
  objectClass?: string | null;
  /** Exclude same-family-name hits (suppress STARLINK-X → STARLINK-Y noise). */
  excludeSameFamily?: boolean;
  /** HNSW ef_search at query time — 100 is a good recall/latency balance. */
  efSearch?: number;
}

export async function queryConjunctionCandidatesKnn(
  db: Database,
  opts: ConjunctionCandidatesKnnOpts,
): Promise<ConjunctionCandidateKnn[]> {
  const knnK = opts.knnK ?? 200;
  const limit = opts.limit ?? 50;
  const marginKm = opts.marginKm ?? 20;
  const efSearch = opts.efSearch ?? 100;

  // pgvector HNSW ef_search is session-scoped; `SET` can't take a bind
  // parameter, so we validate + interpolate an integer literal.
  const ef = Math.max(10, Math.min(1000, Math.floor(efSearch)));
  await db.execute(sql.raw(`SET hnsw.ef_search = ${ef}`));

  const rows = await db.execute(sql`
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
              -- suppress runaway "constellation self-neighbours" like STARLINK-X → STARLINK-Y
              split_part(t.name, ' ', 1) = split_part(k.name, ' ', 1)
              AND t.name ~ '[A-Z]+-?[0-9]+$'
            )`
          : sql``
      }
    ORDER BY k.cos_distance ASC
    LIMIT ${limit}
  `);

  return rows.rows as unknown as ConjunctionCandidateKnn[];
}

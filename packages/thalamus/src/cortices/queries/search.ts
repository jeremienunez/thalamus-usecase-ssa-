/**
 * SQL helpers — Telemetry Profile Search.
 *
 * Cosine similarity on telemetry_14d vectors (HNSW index).
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

export interface SimilarSatelliteRow {
  id: bigint;
  name: string;
  massKg: number | null;
  operatorCountryName: string;
  orbitRegimeName: string;
  similarity: number;
}

/**
 * Find satellites closest to a target 14D telemetry profile via HNSW cosine search.
 * Same engine as conjunction_vector_search() but without encounter context.
 */
export async function searchByTelemetry14d(
  db: Database,
  profile: number[],
  opts: { orbitRegime?: string; limit?: number },
): Promise<SimilarSatelliteRow[]> {
  const orbitRegimeFilter = opts.orbitRegime
    ? sql`AND orb.name = ${opts.orbitRegime}`
    : sql``;

  const results = await db.execute(sql`
    SELECT s.id, s.name, s.mass_kg as "massKg",
      oc.name as "operatorCountryName", orb.name as "orbitRegimeName",
      1.0 - (s.telemetry_14d <=> ${JSON.stringify(profile)}::vector) as similarity
    FROM satellite s
    JOIN operator_country oc ON oc.id = s.operator_country_id
    JOIN orbit_regime orb ON orb.id = oc.orbit_regime_id
    WHERE s.signal_power_dbw IS NOT NULL
      ${orbitRegimeFilter}
    ORDER BY s.telemetry_14d <=> ${JSON.stringify(profile)}::vector
    LIMIT ${opts.limit ?? 20}
  `);

  return results.rows as unknown as SimilarSatelliteRow[];
}

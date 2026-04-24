import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import { TELEMETRY_SCALAR_COLUMN } from "../types/sim-telemetry.types";
import { fieldSqlFor } from "../utils/sql-field";

export class SatelliteFieldEnrichmentRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /** Writes a whitelisted field on a satellite row. */
  async updateField(
    satelliteId: bigint,
    field: string,
    value: string | number,
  ): Promise<void> {
    const col = fieldSqlFor(field);
    await this.db.execute(
      sql`UPDATE satellite SET ${col} = ${value} WHERE id = ${satelliteId}`,
    );
  }

  async knnNeighboursForField(
    targetId: bigint,
    field: string,
    k: number,
    efSearch = 100,
  ): Promise<
    Array<{
      id: string;
      noradId: number | null;
      value: string | number | null;
      cos_distance: number;
    }>
  > {
    const col = fieldSqlFor(field);
    const ef = Math.max(10, Math.min(1000, Math.floor(efSearch)));
    await this.db.execute(sql.raw(`SET hnsw.ef_search = ${ef}`));
    const rows = await this.db.execute<{
      id: string;
      noradId: number | null;
      value: string | number | null;
      cos_distance: number;
    }>(sql`
      SELECT
        s.id::text AS id,
        s.norad_id AS "noradId",
        s.${col} AS value,
        (s.embedding <=> t.embedding)::float AS cos_distance
      FROM satellite s, (SELECT embedding FROM satellite WHERE id = ${targetId}) t
      WHERE s.id != ${targetId}
        AND s.object_class = 'payload'
        AND s.${col} IS NOT NULL
        AND s.embedding IS NOT NULL
      ORDER BY s.embedding <=> t.embedding
      LIMIT ${k}
    `);
    return rows.rows;
  }

  /**
   * Telemetry scalar columns that are currently NULL on a given satellite.
   * Returns a Set keyed by snake_case column name.
   */
  async findNullTelemetryColumns(satelliteId: bigint): Promise<Set<string>> {
    const cols = Object.values(TELEMETRY_SCALAR_COLUMN);
    const selects = cols.map((c) => `"${c}" IS NULL AS "${c}"`).join(", ");
    const res = await this.db.execute(
      sql.raw(
        `SELECT ${selects} FROM satellite WHERE id = ${satelliteId.toString()}::bigint LIMIT 1`,
      ),
    );
    const row = res.rows[0] as Record<string, boolean | null> | undefined;
    if (!row) return new Set();
    const out = new Set<string>();
    for (const c of cols) {
      if (row[c] === true) out.add(c);
    }
    return out;
  }
}

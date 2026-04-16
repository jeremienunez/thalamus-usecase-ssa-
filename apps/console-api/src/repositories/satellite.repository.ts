import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { Regime } from "@interview/shared";
import { fieldSqlFor } from "../utils/sql-field";

export type SatelliteOrbitalRow = {
  id: string;
  name: string;
  norad_id: number | null;
  operator: string | null;
  operator_country: string | null;
  launch_year: number | null;
  mass_kg: number | null;
  classification_tier: string | null;
  opacity_score: string | null;
  telemetry_summary: Record<string, unknown> | null;
};

export type SatelliteNameRow = {
  id: string;
  name: string;
  norad_id: string | null;
};

export class SatelliteRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async listWithOrbital(
    limit: number,
    regime?: Regime,
  ): Promise<SatelliteOrbitalRow[]> {
    // Regime filter pushed to SQL so it composes with LIMIT correctly.
    // Prefer the explicit regime field on telemetry_summary when present;
    // otherwise derive from meanMotion using the same thresholds as
    // regimeFromMeanMotion() in @interview/shared
    // (<1.1 → GEO, <5 → MEO, <11 → HEO, else LEO).
    const regimeFilter = regime
      ? sql`AND COALESCE(
          UPPER(NULLIF(s.telemetry_summary->>'regime', '')),
          CASE
            WHEN (s.telemetry_summary->>'meanMotion')::float < 1.1 THEN 'GEO'
            WHEN (s.telemetry_summary->>'meanMotion')::float < 5   THEN 'MEO'
            WHEN (s.telemetry_summary->>'meanMotion')::float < 11  THEN 'HEO'
            ELSE 'LEO'
          END
        ) = ${regime}`
      : sql``;

    const rows = await this.db.execute<SatelliteOrbitalRow>(sql`
      SELECT
        s.id::text                                       AS id,
        s.name,
        NULLIF(s.telemetry_summary->>'noradId','')::int  AS norad_id,
        op.name                                          AS operator,
        oc.name                                          AS operator_country,
        s.launch_year,
        s.mass_kg,
        s.classification_tier,
        s.opacity_score::text,
        s.telemetry_summary
      FROM satellite s
      LEFT JOIN operator op          ON op.id = s.operator_id
      LEFT JOIN operator_country oc  ON oc.id = s.operator_country_id
      WHERE s.telemetry_summary ? 'raan'
        ${regimeFilter}
      ORDER BY s.id
      LIMIT ${limit}
    `);
    return rows.rows;
  }

  async findPayloadNamesByIds(ids: bigint[]): Promise<SatelliteNameRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.execute<SatelliteNameRow>(sql`
      SELECT id::text, name, norad_id::text
      FROM satellite
      WHERE id = ANY(${sql`ARRAY[${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}]::bigint[]`})
        AND object_class = 'payload'
    `);
    return rows.rows;
  }

  /** Writes a whitelisted field on a satellite row. Field must be in MISSION_WRITABLE_COLUMNS. */
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

  async listNullCandidatesForField(
    field: string,
    limit: number,
  ): Promise<{ id: string; name: string }[]> {
    const col = fieldSqlFor(field);
    const rows = await this.db.execute<{ id: string; name: string }>(sql`
      SELECT id::text, name
      FROM satellite
      WHERE object_class = 'payload'
        AND embedding IS NOT NULL
        AND ${col} IS NULL
      LIMIT ${limit}
    `);
    return rows.rows;
  }

  async knnNeighboursForField(
    targetId: bigint,
    field: string,
    k: number,
  ): Promise<
    Array<{ id: string; value: string | number | null; cos_distance: number }>
  > {
    const col = fieldSqlFor(field);
    const rows = await this.db.execute<{
      id: string;
      value: string | number | null;
      cos_distance: number;
    }>(sql`
      SELECT
        s.id::text AS id,
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
}

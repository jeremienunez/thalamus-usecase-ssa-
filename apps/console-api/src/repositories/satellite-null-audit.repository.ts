import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import { fieldSqlFor } from "../utils/sql-field";

export class SatelliteNullAuditRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async listNullCandidatesForField(
    field: string,
    limit: number,
  ): Promise<{ id: string; name: string; noradId: number | null }[]> {
    const col = fieldSqlFor(field);
    const rows = await this.db.execute<{
      id: string;
      name: string;
      noradId: number | null;
    }>(sql`
      SELECT id::text, name, norad_id AS "noradId"
      FROM satellite
      WHERE object_class = 'payload'
        AND embedding IS NOT NULL
        AND ${col} IS NULL
      LIMIT ${limit}
    `);
    return rows.rows;
  }

  /**
   * Discover nullable scalar columns on `satellite` at call time.
   * Excluded by policy: id, name, slug, timestamps, jsonb, descriptions.
   */
  async discoverNullableScalarColumns(): Promise<string[]> {
    const res = await this.db.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'satellite'
        AND is_nullable  = 'YES'
    `);
    const EXCLUDED = new Set<string>([
      "id",
      "name",
      "slug",
      "created_at",
      "updated_at",
      "profile_metadata",
      "descriptions",
      "metadata",
      "telemetry_summary",
      "g_short_description",
      "g_description",
      "g_operator_description",
      "g_operator_country_description",
      "g_orbit_regime_description",
      "g_launch_year_description",
      "photo_url",
    ]);
    const SCALAR_TYPES = new Set<string>([
      "integer",
      "bigint",
      "smallint",
      "real",
      "double precision",
      "numeric",
      "text",
      "character varying",
      "boolean",
    ]);
    return (res.rows as Array<{ column_name: string; data_type: string }>)
      .filter(
        (r) =>
          !EXCLUDED.has(r.column_name) &&
          SCALAR_TYPES.has(r.data_type.toLowerCase()),
      )
      .map((r) => r.column_name);
  }

  /** Null-fraction scan by (operator_country x column). */
  async nullScanByColumn(opts?: {
    maxOperatorCountries?: number;
    minNullFraction?: number;
    minTotal?: number;
    columns?: string[];
  }): Promise<
    Array<{
      operatorCountryId: bigint | null;
      operatorCountryName: string;
      totalSatellites: number;
      column: string;
      nullCount: number;
      nullFraction: number;
    }>
  > {
    const threshold = opts?.minNullFraction ?? 0.1;
    const minTotal = opts?.minTotal ?? 3;
    const limit = opts?.maxOperatorCountries ?? 500;

    const allCols = opts?.columns?.length
      ? opts.columns
      : await this.discoverNullableScalarColumns();
    if (allCols.length === 0) return [];

    const discovered = new Set(await this.discoverNullableScalarColumns());
    const safeCols = allCols.filter((c) => discovered.has(c));
    if (safeCols.length === 0) return [];

    const selects = safeCols
      .map(
        (c, i) =>
          `count(*) FILTER (WHERE s."${c}" IS NULL)::int AS "nc_${i}"`,
      )
      .join(",\n  ");

    const query = sql.raw(`
      SELECT
        s.operator_country_id::text       AS operator_country_id,
        oc.name                           AS operator_country_name,
        count(*)::int                     AS total_count,
        ${selects}
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      GROUP BY s.operator_country_id, oc.name
      HAVING count(*) >= ${minTotal}
      ORDER BY total_count DESC
      LIMIT ${limit}
    `);

    const res = await this.db.execute<Record<string, string | number | null>>(
      query,
    );

    const out: Array<{
      operatorCountryId: bigint | null;
      operatorCountryName: string;
      totalSatellites: number;
      column: string;
      nullCount: number;
      nullFraction: number;
    }> = [];
    for (const row of res.rows as Array<Record<string, string | number | null>>) {
      const ocId =
        row.operator_country_id !== null &&
        row.operator_country_id !== undefined
          ? BigInt(row.operator_country_id as string | number)
          : null;
      const name =
        (row.operator_country_name as string | null) ?? "(no country)";
      const total = Number(row.total_count ?? 0);
      if (total < minTotal) continue;
      for (let i = 0; i < safeCols.length; i++) {
        const nc = Number(row[`nc_${i}`] ?? 0);
        if (nc === 0) continue;
        const frac = nc / total;
        if (frac < threshold) continue;
        out.push({
          operatorCountryId: ocId,
          operatorCountryName: name,
          totalSatellites: total,
          column: safeCols[i]!,
          nullCount: nc,
          nullFraction: frac,
        });
      }
    }

    out.sort((a, b) => {
      if (b.nullFraction !== a.nullFraction)
        return b.nullFraction - a.nullFraction;
      return b.nullCount - a.nullCount;
    });
    return out;
  }

  /** Satellite IDs for (operator_country x column) where column IS NULL. */
  async findSatelliteIdsWithNullColumn(opts: {
    operatorCountryId: bigint | null;
    column: string;
    limit?: number;
  }): Promise<bigint[]> {
    const discovered = new Set(await this.discoverNullableScalarColumns());
    if (!discovered.has(opts.column)) {
      throw new Error(
        `column '${opts.column}' is not a nullable scalar on satellite`,
      );
    }
    const limit = opts.limit ?? 200;
    const ocFilter =
      opts.operatorCountryId !== null
        ? `AND s.operator_country_id = ${opts.operatorCountryId.toString()}::bigint`
        : `AND s.operator_country_id IS NULL`;
    const query = sql.raw(`
      SELECT s.id::text AS id
      FROM satellite s
      WHERE s."${opts.column}" IS NULL
        ${ocFilter}
      ORDER BY s.id
      LIMIT ${limit}
    `);
    const res = await this.db.execute<{ id: string }>(query);
    return (res.rows as Array<{ id: string }>).map((r) => BigInt(r.id));
  }
}

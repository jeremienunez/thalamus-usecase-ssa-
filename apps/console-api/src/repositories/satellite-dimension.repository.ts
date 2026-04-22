import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import {
  satelliteDimensionJoinsSql,
  satelliteOrbitRegimeJoinSql,
} from "./satellite-dimension.sql";
import type {
  CatalogContextRow,
  FindByIdFullRow,
  ListByOperatorRow,
} from "../types/satellite.types";

/**
 * SatelliteDimensionRepository — canonical catalog-dimension reads rooted at
 * `satellite s`.
 *
 * Owns the narrow, reusable "who/where/what bus/platform/regime" lookups that
 * are shared by HTTP enrichment flows and sim target composition.
 */
export class SatelliteDimensionRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findByIdFull(
    id: bigint | number,
  ): Promise<FindByIdFullRow | null> {
    const results = await this.db.execute<FindByIdFullRow>(sql`
      SELECT
        s.id, s.name, s.slug,
        s.norad_id AS "noradId",
        s.launch_year as "launchYear",
        op.name as "operatorName", op.id as "operatorId",
        oc.name as "operatorCountryName", oc.id as "operatorCountryId",
        pc.name as "platformClassName", pc.id as "platformClassId",
        orr.name as "orbitRegimeName", orr.id as "orbitRegimeId",
        sb.name as "busName",
        s.telemetry_summary as "telemetrySummary"
      FROM satellite s
      ${satelliteDimensionJoinsSql}
      ${satelliteOrbitRegimeJoinSql}
      WHERE s.id = ${BigInt(id)}
      LIMIT 1
    `);

    return results.rows[0] ?? null;
  }

  async listByOperator(
    opts: { operator?: string; limit?: number },
  ): Promise<ListByOperatorRow[]> {
    const operatorFilter = opts.operator
      ? sql`AND op.name = ${opts.operator}`
      : sql``;

    const results = await this.db.execute<ListByOperatorRow>(sql`
      SELECT
        s.id, s.name, s.slug,
        s.norad_id AS "noradId",
        s.launch_year as "launchYear",
        op.name as "operatorName", op.id as "operatorId",
        oc.name as "operatorCountryName", oc.id as "operatorCountryId",
        pc.name as "platformClassName", pc.id as "platformClassId",
        orr.name as "orbitRegimeName", orr.id as "orbitRegimeId",
        sb.name as "busName",
        s.telemetry_summary as "telemetrySummary"
      FROM satellite s
      ${satelliteDimensionJoinsSql}
      ${satelliteOrbitRegimeJoinSql}
      WHERE 1 = 1
        ${operatorFilter}
      ORDER BY s.launch_year DESC NULLS LAST, s.name ASC
      LIMIT ${opts.limit ?? 200}
    `);

    return results.rows;
  }

  async listCatalogContext(
    opts: { source?: string; sinceEpoch?: string; limit?: number } = {},
  ): Promise<CatalogContextRow[]> {
    const sinceFilter = opts.sinceEpoch
      ? sql`AND s.created_at > ${opts.sinceEpoch}::timestamptz`
      : sql``;

    const results = await this.db.execute<CatalogContextRow>(sql`
      SELECT
        s.id::int AS "satelliteId",
        s.name,
        s.norad_id AS "noradId",
        op.name AS "operator",
        oc.name AS "operatorCountry",
        pc.name AS "platformClass",
        orr.name AS "orbitRegime",
        s.launch_year AS "launchYear",
        s.created_at::text AS "ingestedAt"
      FROM satellite s
      ${satelliteDimensionJoinsSql}
      ${satelliteOrbitRegimeJoinSql}
      WHERE 1 = 1
        ${sinceFilter}
      ORDER BY s.created_at DESC
      LIMIT ${opts.limit ?? 50}
    `);

    return results.rows;
  }
}

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export class FleetAnalysisRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  // ← absorbed from cortices/queries/operator-fleet.ts
  async analyzeOperatorFleet(
    opts: {
      operatorId?: string | number | bigint;
      userId?: string | number | bigint;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      operatorId: number;
      operatorName: string;
      country: string | null;
      satelliteCount: number;
      avgAgeYears: number | null;
      regimeMix: Record<string, number>;
      platformMix: Record<string, number>;
      busMix: Record<string, number>;
    }>
  > {
    const opFilter = opts.operatorId
      ? sql`WHERE op.id = ${BigInt(opts.operatorId as string | number)}`
      : sql``;

    const results = await this.db.execute(sql`
      WITH base AS (
        SELECT
          op.id AS operator_id,
          op.name AS operator_name,
          oc.name AS country,
          s.id AS sat_id,
          s.launch_year,
          orr.name AS regime,
          pc.name AS platform,
          sb.name AS bus
        FROM operator op
        LEFT JOIN satellite s          ON s.operator_id         = op.id
        LEFT JOIN operator_country oc  ON oc.id                 = s.operator_country_id
        LEFT JOIN orbit_regime orr     ON orr.id                = oc.orbit_regime_id
        LEFT JOIN platform_class pc    ON pc.id                 = s.platform_class_id
        LEFT JOIN satellite_bus sb     ON sb.id                 = s.satellite_bus_id
        ${opFilter}
      ),
      mix AS (
        SELECT
          operator_id,
          operator_name,
          (array_agg(country) FILTER (WHERE country IS NOT NULL))[1] AS country,
          count(sat_id)::int AS satellite_count,
          (extract(year from now())::int - avg(launch_year))::real AS avg_age_years,
          COALESCE(
            jsonb_object_agg(regime, regime_count)
              FILTER (WHERE regime IS NOT NULL),
            '{}'::jsonb
          ) AS regime_mix,
          COALESCE(
            jsonb_object_agg(platform, platform_count)
              FILTER (WHERE platform IS NOT NULL),
            '{}'::jsonb
          ) AS platform_mix,
          COALESCE(
            jsonb_object_agg(bus, bus_count)
              FILTER (WHERE bus IS NOT NULL),
            '{}'::jsonb
          ) AS bus_mix
        FROM (
          SELECT
            operator_id, operator_name, country, sat_id, launch_year,
            regime, count(*) OVER (PARTITION BY operator_id, regime) AS regime_count,
            platform, count(*) OVER (PARTITION BY operator_id, platform) AS platform_count,
            bus, count(*) OVER (PARTITION BY operator_id, bus) AS bus_count
          FROM base
        ) d
        GROUP BY operator_id, operator_name
      )
      SELECT
        operator_id::int AS "operatorId",
        operator_name AS "operatorName",
        country,
        satellite_count AS "satelliteCount",
        avg_age_years AS "avgAgeYears",
        regime_mix AS "regimeMix",
        platform_mix AS "platformMix",
        bus_mix AS "busMix"
      FROM mix
      WHERE satellite_count > 0
      ORDER BY satellite_count DESC
      LIMIT ${opts.limit ?? 10}
    `);

    return results.rows as unknown as Array<{
      operatorId: number;
      operatorName: string;
      country: string | null;
      satelliteCount: number;
      avgAgeYears: number | null;
      regimeMix: Record<string, number>;
      platformMix: Record<string, number>;
      busMix: Record<string, number>;
    }>;
  }

  // ← absorbed from cortices/queries/orbit-regime.ts
  async profileOrbitRegime(
    opts: {
      operatorCountryName?: string;
      operatorCountryId?: string | number;
      orbitRegime?: string;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      regimeId: string;
      regimeName: string;
      altitudeBand: string | null;
      operatorCountryId: string | null;
      operatorCountryName: string | null;
      satelliteCount: number;
      operatorCount: number;
      topOperators: string[];
      doctrineKeys: string[];
    }>
  > {
    const limit = opts.limit ?? 10;

    let filter = sql``;
    if (opts.operatorCountryId !== undefined) {
      filter = sql`AND oc.id = ${BigInt(opts.operatorCountryId)}`;
    } else if (opts.operatorCountryName) {
      filter = sql`AND oc.name = ${opts.operatorCountryName}`;
    } else if (opts.orbitRegime) {
      filter = sql`AND orr.name = ${opts.orbitRegime}`;
    }

    const results = await this.db.execute(sql`
      WITH regime_counts AS (
        SELECT
          orr.id AS regime_id,
          orr.name AS regime_name,
          orr.altitude_band,
          oc.id AS operator_country_id,
          oc.name AS operator_country_name,
          oc.doctrine,
          s.id AS satellite_id,
          s.operator_id,
          op.name AS operator_name
        FROM orbit_regime orr
        JOIN operator_country oc ON oc.orbit_regime_id = orr.id
        LEFT JOIN satellite s ON s.operator_country_id = oc.id
        LEFT JOIN operator op ON op.id = s.operator_id
        WHERE 1=1 ${filter}
      ),
      operator_counts AS (
        SELECT
          regime_id,
          operator_country_id,
          operator_id,
          operator_name,
          count(satellite_id)::int AS sat_count
        FROM regime_counts
        WHERE operator_id IS NOT NULL
        GROUP BY regime_id, operator_country_id, operator_id, operator_name
      ),
      top_operators AS (
        SELECT
          regime_id,
          operator_country_id,
          (ARRAY_AGG(operator_name ORDER BY sat_count DESC))[1:5] AS top_ops,
          count(DISTINCT operator_id)::int AS operator_count
        FROM operator_counts
        GROUP BY regime_id, operator_country_id
      ),
      agg AS (
        SELECT
          regime_id,
          regime_name,
          altitude_band,
          operator_country_id,
          operator_country_name,
          doctrine,
          count(satellite_id)::int AS sat_count
        FROM regime_counts
        GROUP BY regime_id, regime_name, altitude_band, operator_country_id, operator_country_name, doctrine
      )
      SELECT
        a.regime_id::text AS "regimeId",
        a.regime_name AS "regimeName",
        a.altitude_band AS "altitudeBand",
        a.operator_country_id::text AS "operatorCountryId",
        a.operator_country_name AS "operatorCountryName",
        a.sat_count AS "satelliteCount",
        COALESCE(t.operator_count, 0) AS "operatorCount",
        COALESCE(t.top_ops, ARRAY[]::text[]) AS "topOperators",
        CASE
          WHEN a.doctrine IS NULL OR jsonb_typeof(a.doctrine) <> 'object' THEN ARRAY[]::text[]
          ELSE ARRAY(SELECT jsonb_object_keys(a.doctrine))
        END AS "doctrineKeys"
      FROM agg a
      LEFT JOIN top_operators t
        ON t.regime_id = a.regime_id
       AND t.operator_country_id = a.operator_country_id
      ORDER BY a.sat_count DESC
      LIMIT ${limit}
    `);

    type Row = {
      regimeId: string;
      regimeName: string;
      altitudeBand: string | null;
      operatorCountryId: string | null;
      operatorCountryName: string | null;
      satelliteCount: number;
      operatorCount: number;
      topOperators: string[];
      doctrineKeys: string[];
    };

    return (results.rows as unknown as Row[]).map((r) => ({
      ...r,
      regimeId: String(r.regimeId),
      operatorCountryId:
        r.operatorCountryId == null ? null : String(r.operatorCountryId),
      topOperators: (r.topOperators ?? []).filter(
        (x): x is string => x != null,
      ),
      doctrineKeys: r.doctrineKeys ?? [],
    }));
  }

  // ← absorbed from cortices/queries/orbit-slot.ts
  async planOrbitSlots(
    opts: {
      operatorId?: string | number | bigint;
      horizonYears?: number;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      regimeId: number;
      regimeName: string;
      operatorId: number | null;
      operatorName: string | null;
      satellitesInRegime: number;
      shareOfRegimePct: number;
    }>
  > {
    const opFilter = opts.operatorId
      ? sql`AND op.id = ${BigInt(opts.operatorId as string | number)}`
      : sql``;

    const results = await this.db.execute(sql`
      WITH regime_totals AS (
        SELECT oc.orbit_regime_id AS rid, count(s.id)::int AS total
        FROM satellite s
        JOIN operator_country oc ON oc.id = s.operator_country_id
        WHERE oc.orbit_regime_id IS NOT NULL
        GROUP BY oc.orbit_regime_id
      )
      SELECT
        orr.id::int AS "regimeId",
        orr.name   AS "regimeName",
        op.id::int AS "operatorId",
        op.name    AS "operatorName",
        count(s.id)::int AS "satellitesInRegime",
        (count(s.id) * 100.0 / NULLIF(rt.total, 0))::real AS "shareOfRegimePct"
      FROM satellite s
      JOIN operator_country oc  ON oc.id = s.operator_country_id
      JOIN orbit_regime orr     ON orr.id = oc.orbit_regime_id
      LEFT JOIN operator op     ON op.id = s.operator_id
      JOIN regime_totals rt     ON rt.rid = orr.id
      WHERE 1 = 1
        ${opFilter}
      GROUP BY orr.id, orr.name, op.id, op.name, rt.total
      ORDER BY "shareOfRegimePct" DESC NULLS LAST
      LIMIT ${opts.limit ?? 20}
    `);

    return results.rows as unknown as Array<{
      regimeId: number;
      regimeName: string;
      operatorId: number | null;
      operatorName: string | null;
      satellitesInRegime: number;
      shareOfRegimePct: number;
    }>;
  }
}

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { Regime } from "@interview/shared";
import { TELEMETRY_SCALAR_COLUMN } from "../types/sim-telemetry.types";
import { fieldSqlFor } from "../utils/sql-field";
import {
  satelliteDimensionJoinsSql,
  satelliteOrbitRegimeJoinSql,
} from "./satellite-dimension.sql";
import { SatelliteDimensionRepository } from "./satellite-dimension.repository";
import type {
  SatelliteOrbitalRow,
  SatelliteNameRow,
  FindByIdFullRow,
  ListByOperatorRow,
} from "../types/satellite.types";

export type {
  SatelliteOrbitalRow,
  SatelliteNameRow,
  FindByIdFullRow,
  ListByOperatorRow,
} from "../types/satellite.types";

export class SatelliteRepository {
  private readonly dimensions: SatelliteDimensionRepository;

  constructor(private readonly db: NodePgDatabase<typeof schema>) {
    this.dimensions = new SatelliteDimensionRepository(db);
  }

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
        s.telemetry_summary,
        s.object_class,
        s.photo_url,
        s.g_short_description,
        s.g_description,
        pc.name                                          AS platform_class_name,
        sb.name                                          AS bus_name,
        sb.generation                                    AS bus_generation,
        s.power_draw,
        s.thermal_margin,
        s.pointing_accuracy,
        s.attitude_rate,
        s.link_budget,
        s.data_rate,
        s.payload_duty,
        s.eclipse_ratio,
        s.solar_array_health,
        s.battery_depth_of_discharge,
        s.propellant_remaining,
        s.radiation_dose,
        s.debris_proximity,
        s.mission_age,
        th_latest.last_tle_ingested_at,
        (th_latest.latest_mm - th_prev.prev_mm)::real AS mean_motion_drift
      FROM satellite s
      ${satelliteDimensionJoinsSql}
      LEFT JOIN LATERAL (
        SELECT ingested_at AS last_tle_ingested_at, mean_motion AS latest_mm
        FROM tle_history
        WHERE satellite_id = s.id
        ORDER BY ingested_at DESC
        LIMIT 1
      ) th_latest ON TRUE
      LEFT JOIN LATERAL (
        SELECT mean_motion AS prev_mm
        FROM tle_history
        WHERE satellite_id = s.id
        ORDER BY ingested_at DESC
        OFFSET 1 LIMIT 1
      ) th_prev ON TRUE
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

  /** Full satellite lookup by id with all joins (incl. satellite_bus). */
  async findByIdFull(
    id: bigint | number,
  ): Promise<FindByIdFullRow | null> {
    return this.dimensions.findByIdFull(id);
  }

  /** List satellites by operator name. */
  async listByOperator(
    opts: { operator?: string; limit?: number },
  ): Promise<ListByOperatorRow[]> {
    return this.dimensions.listByOperator(opts);
  }

  /** Mission windows with EOL projections. */
  async listMissionWindows(
    opts: { orbitRegime?: string; limit?: number },
  ): Promise<
    Array<{
      id: bigint;
      name: string;
      slug: string;
      noradId: number | null;
      launchYear: number | null;
      operatorName: string | null;
      operatorId: bigint | null;
      operatorCountryName: string | null;
      operatorCountryId: bigint | null;
      platformClassName: string | null;
      platformClassId: bigint | null;
      orbitRegimeName: string | null;
      orbitRegimeId: bigint | null;
      telemetrySummary: Record<string, unknown> | null;
      currentPhase: string | null;
      nominalLifeYears: number | null;
      maxLifeYears: number | null;
      currentAgeYears: number | null;
      yearsToEol: number | null;
    }>
  > {
    const regimeFilter = opts.orbitRegime
      ? sql`AND orr.name = ${opts.orbitRegime}`
      : sql``;

    const results = await this.db.execute<{
      id: bigint;
      name: string;
      slug: string;
      noradId: number | null;
      launchYear: number | null;
      operatorName: string | null;
      operatorId: bigint | null;
      operatorCountryName: string | null;
      operatorCountryId: bigint | null;
      platformClassName: string | null;
      platformClassId: bigint | null;
      orbitRegimeName: string | null;
      orbitRegimeId: bigint | null;
      telemetrySummary: Record<string, unknown> | null;
      currentPhase: string | null;
      nominalLifeYears: number | null;
      maxLifeYears: number | null;
      currentAgeYears: number | null;
      yearsToEol: number | null;
    }>(sql`
      WITH satellite_base AS (
        SELECT
          s.id, s.name, s.slug,
          s.launch_year as "launchYear",
          op.name as "operatorName", op.id as "operatorId",
          oc.name as "operatorCountryName", oc.id as "operatorCountryId",
          pc.name as "platformClassName", pc.id as "platformClassId",
          orr.name as "orbitRegimeName", orr.id as "orbitRegimeId",
          s.telemetry_summary as "telemetrySummary"
        FROM satellite s
        ${satelliteDimensionJoinsSql}
        ${satelliteOrbitRegimeJoinSql}
        WHERE s.launch_year IS NOT NULL
          AND s.launch_year > 1957
          ${regimeFilter}
      )
      SELECT sb.*,
        (mw.result->>'current_phase') as "currentPhase",
        (mw.result->>'nominal_life_years')::real as "nominalLifeYears",
        (mw.result->>'max_life_years')::real as "maxLifeYears",
        (mw.result->>'current_age_years')::real as "currentAgeYears",
        GREATEST(0, (mw.result->>'nominal_life_years')::real
          - COALESCE((mw.result->>'current_age_years')::real, 0)) as "yearsToEol"
      FROM satellite_base sb
      LEFT JOIN LATERAL (SELECT safe_mission_window(sb.id) as result) mw ON true
      WHERE (mw.result->>'current_phase') IS NOT NULL
      ORDER BY GREATEST(0, (mw.result->>'nominal_life_years')::real
        - COALESCE((mw.result->>'current_age_years')::real, 0)) ASC NULLS LAST
      LIMIT ${opts.limit ?? 200}
    `);

    return results.rows;
  }

  // ─── Nano-sweep audit queries ─────────────────────────────────────
  //
  // Folded from packages/sweep/src/repositories/satellite.repository.ts in
  // Plan 1 Task 4.1. Consumed by the SSA sweep pack (SsaAuditProvider)
  // through the injected satelliteRepo dep.

  /** Aggregated stats per operator-country for nano-sweep audit. */
  async getOperatorCountrySweepStats(): Promise<
    Array<{
      operatorCountryId: bigint;
      operatorCountryName: string;
      orbitRegimeName: string;
      satelliteCount: number;
      missingPayloads: number;
      missingOrbitRegime: number;
      missingLaunchYear: number;
      missingMass: number;
      hasDoctrine: boolean;
      avgMass: number | null;
      topPayloads: string[];
      sampleSatellites: Array<{
        name: string;
        massKg: number;
        launchYear: number | null;
      }>;
    }>
  > {
    const rows = await this.db.execute<{
      operator_country_id: string;
      operator_country_name: string;
      orbit_regime_name: string;
      satellite_count: number;
      missing_payloads: number;
      missing_orbit_regime: number;
      missing_launch_year: number;
      missing_mass: number;
      has_doctrine: boolean;
      avg_mass: number | null;
      top_payloads: string[];
      sample_satellites: Array<{
        name: string;
        massKg: number;
        launchYear: number | null;
      }>;
    }>(sql`
      WITH operator_country_stats AS (
        SELECT
          oc.id::text AS operator_country_id,
          oc.name AS operator_country_name,
          reg.name AS orbit_regime_name,
          count(s.id)::int AS satellite_count,
          count(s.id) FILTER (
            WHERE NOT EXISTS (
              SELECT 1
              FROM satellite_payload sp
              WHERE sp.satellite_id = s.id
            )
          )::int AS missing_payloads,
          count(s.id) FILTER (
            WHERE s.g_orbit_regime_description IS NULL
              OR s.g_orbit_regime_description = ''
          )::int AS missing_orbit_regime,
          count(s.id) FILTER (WHERE s.launch_year IS NULL)::int AS missing_launch_year,
          count(s.id) FILTER (
            WHERE s.mass_kg = 0 OR s.mass_kg IS NULL
          )::int AS missing_mass,
          (oc.doctrine IS NOT NULL) AS has_doctrine,
          round(avg(s.mass_kg) FILTER (WHERE s.mass_kg > 0))::real AS avg_mass
        FROM operator_country oc
        JOIN orbit_regime reg ON reg.id = oc.orbit_regime_id
        LEFT JOIN satellite s ON s.operator_country_id = oc.id
        GROUP BY oc.id, oc.name, reg.name, oc.doctrine
        HAVING count(s.id) > 0
      ),
      ranked_payloads AS (
        SELECT
          s.operator_country_id::text AS operator_country_id,
          p.name,
          count(*)::int AS payload_count,
          row_number() OVER (
            PARTITION BY s.operator_country_id
            ORDER BY count(*) DESC, p.name ASC
          ) AS rank
        FROM satellite_payload sp
        JOIN payload p ON p.id = sp.payload_id
        JOIN satellite s ON s.id = sp.satellite_id
        GROUP BY s.operator_country_id, p.name
      ),
      top_payloads AS (
        SELECT
          operator_country_id,
          array_agg(name ORDER BY payload_count DESC, name ASC) AS top_payloads
        FROM ranked_payloads
        WHERE rank <= 5
        GROUP BY operator_country_id
      ),
      ranked_samples AS (
        SELECT
          s.operator_country_id::text AS operator_country_id,
          s.name,
          s.mass_kg,
          s.launch_year,
          row_number() OVER (
            PARTITION BY s.operator_country_id
            ORDER BY s.mass_kg DESC, s.name ASC
          ) AS rank
        FROM satellite s
        WHERE s.mass_kg > 0
      ),
      sample_satellites AS (
        SELECT
          operator_country_id,
          jsonb_agg(
            jsonb_build_object(
              'name', name,
              'massKg', mass_kg,
              'launchYear', launch_year
            )
            ORDER BY mass_kg DESC, name ASC
          ) AS sample_satellites
        FROM ranked_samples
        WHERE rank <= 3
        GROUP BY operator_country_id
      )
      SELECT
        ocs.operator_country_id,
        ocs.operator_country_name,
        ocs.orbit_regime_name,
        ocs.satellite_count,
        ocs.missing_payloads,
        ocs.missing_orbit_regime,
        ocs.missing_launch_year,
        ocs.missing_mass,
        ocs.has_doctrine,
        ocs.avg_mass,
        COALESCE(tp.top_payloads, ARRAY[]::text[]) AS top_payloads,
        COALESCE(ss.sample_satellites, '[]'::jsonb) AS sample_satellites
      FROM operator_country_stats ocs
      LEFT JOIN top_payloads tp
        ON tp.operator_country_id = ocs.operator_country_id
      LEFT JOIN sample_satellites ss
        ON ss.operator_country_id = ocs.operator_country_id
      ORDER BY ocs.satellite_count DESC
    `);

    return rows.rows.map((row) => ({
      operatorCountryId: BigInt(row.operator_country_id),
      operatorCountryName: row.operator_country_name,
      orbitRegimeName: row.orbit_regime_name,
      satelliteCount: row.satellite_count,
      missingPayloads: row.missing_payloads,
      missingOrbitRegime: row.missing_orbit_regime,
      missingLaunchYear: row.missing_launch_year,
      missingMass: row.missing_mass,
      hasDoctrine: row.has_doctrine,
      avgMass: row.avg_mass,
      topPayloads: row.top_payloads ?? [],
      sampleSatellites: row.sample_satellites ?? [],
    }));
  }

  /**
   * Discover nullable scalar columns on `satellite` at call time
   * (information_schema introspection). Excluded by policy: id, name, slug,
   * timestamps, jsonb, narrative description columns.
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

  /** Null-fraction scan by (operator_country × column). */
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

  /** Satellite IDs for (operator_country × column) where column IS NULL. */
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

  /**
   * Telemetry scalar columns that are currently NULL on a given satellite.
   * Consumed by `services/sim-promotion.service.ts` to decide which
   * per-scalar sweep_suggestions the telemetry aggregator may emit:
   * non-NULL columns are skipped to avoid overwriting real data.
   *
   * Returns a `Set<string>` keyed by snake_case column name (matches
   * `TELEMETRY_SCALAR_COLUMN` values from @interview/db-schema).
   *
   * Introduced: Plan 5 · 1.A.7 (ported verbatim from the legacy
   * `packages/sweep/src/sim/promote.ts::findNullTelemetryColumns`).
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

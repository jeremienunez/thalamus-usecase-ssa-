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

  // ── Cortex-consumed reads ──────────────────────────────────────────

  /** Launch cost context for the Launch-Cost cortex. */ // ← absorbed from cortices/queries/launch-cost-context.ts
  async getLaunchCostContext(opts: {
    orbitRegime?: string;
    minLaunchCost?: number;
    maxLaunchCost?: number;
    limit?: number;
  }): Promise<
    {
      id: string;
      name: string;
      launchCost: number | null;
      launchYear: number | null;
      operatorCountryName: string;
      orbitRegimeName: string;
      platformClass: string | null;
      kMultiplier: number | null;
      busName: string | null;
      manifestSourceCount: number;
      inclinationDeg: number | null;
      altitudeKm: number | null;
      eccentricity: number | null;
      regimeType: string | null;
      slotCapacityMax: string | null;
      solarFluxZone: string | null;
      radiationZone: string | null;
      solarFluxIndex: number | null;
      kpIndex: number | null;
      radiationIndex: number | null;
    }[]
  > {
    const limit = opts.limit ?? 50;
    const regimeFilter = opts.orbitRegime
      ? sql`AND orr.name = ${opts.orbitRegime}`
      : sql``;
    let costFilter = sql``;
    if (opts.minLaunchCost)
      costFilter = sql`${costFilter} AND s.launch_cost >= ${opts.minLaunchCost}`;
    if (opts.maxLaunchCost)
      costFilter = sql`${costFilter} AND s.launch_cost <= ${opts.maxLaunchCost}`;

    const results = await this.db.execute<{
      id: string;
      name: string;
      launchCost: number | null;
      launchYear: number | null;
      operatorCountryName: string;
      orbitRegimeName: string;
      platformClass: string | null;
      kMultiplier: number | null;
      busName: string | null;
      manifestSourceCount: number;
      inclinationDeg: number | null;
      altitudeKm: number | null;
      eccentricity: number | null;
      regimeType: string | null;
      slotCapacityMax: string | null;
      solarFluxZone: string | null;
      radiationZone: string | null;
      solarFluxIndex: number | null;
      kpIndex: number | null;
      radiationIndex: number | null;
    }>(sql`
      SELECT
        s.id::text, s.name, s.launch_cost as "launchCost",
        s.launch_year as "launchYear",
        oc.name as "operatorCountryName",
        orr.name as "orbitRegimeName",
        pc.name as "platformClass",
        s.k_multiplier as "kMultiplier",
        sb.name as "busName",
        (oc.doctrine->'regime'->'orbit'->>'inclination_deg')::real as "inclinationDeg",
        (oc.doctrine->'regime'->'orbit'->>'altitude_km')::real as "altitudeKm",
        (oc.doctrine->'regime'->'orbit'->>'eccentricity')::real as "eccentricity",
        oc.doctrine->'regime'->'orbit'->>'regime_type' as "regimeType",
        oc.doctrine->>'slot_capacity_max' as "slotCapacityMax",
        oc.doctrine->'regime'->'environment'->'classification'->>'solar_flux_zone' as "solarFluxZone",
        oc.doctrine->'regime'->'environment'->'classification'->>'radiation_zone' as "radiationZone",
        le.solar_flux_index as "solarFluxIndex",
        le.kp_index as "kpIndex",
        le.radiation_index as "radiationIndex",
        COALESCE(manifest.src_count, 0)::int as "manifestSourceCount"
      FROM satellite s
      JOIN operator_country oc ON oc.id = s.operator_country_id
      JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
      LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
      LEFT JOIN satellite_bus sb ON sb.id = s.satellite_bus_id
      LEFT JOIN launch_epoch le ON le.operator_country_id = oc.id AND le.year = s.launch_year
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT si.source_id)::int as src_count
        FROM source_item si
        JOIN source src ON src.id = si.source_id
        WHERE src.kind = 'rss'
          AND src.category = 'LAUNCH_MARKET'
          AND length(split_part(s.name, ' ', 2)) > 2
          AND si.title ILIKE '%' || split_part(s.name, ' ', 2) || '%'
          AND si.fetched_at > now() - interval '30 days'
      ) manifest ON true
      WHERE s.launch_cost IS NOT NULL AND s.launch_cost > 5
        ${regimeFilter}
        ${costFilter}
      ORDER BY COALESCE(manifest.src_count, 0) DESC, s.launch_cost ASC
      LIMIT ${limit}
    `);
    return results.rows;
  }

  /** Cosine similarity search on telemetry_14d vectors. */ // ← absorbed from cortices/queries/search.ts
  async searchByTelemetry(
    profile: number[],
    opts: { orbitRegime?: string; limit?: number },
  ): Promise<
    {
      id: bigint;
      name: string;
      massKg: number | null;
      operatorCountryName: string;
      orbitRegimeName: string;
      similarity: number;
    }[]
  > {
    const orbitRegimeFilter = opts.orbitRegime
      ? sql`AND orb.name = ${opts.orbitRegime}`
      : sql``;

    const results = await this.db.execute<{
      id: bigint;
      name: string;
      massKg: number | null;
      operatorCountryName: string;
      orbitRegimeName: string;
      similarity: number;
    }>(sql`
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
    return results.rows;
  }

  /** Payload context for the Payload-Profiler cortex. */ // ← absorbed from cortices/queries/payload-profiler.ts
  async getPayloadContext(opts: {
    payloadId?: number | bigint;
    payloadName?: string;
    payloadKind?: string;
    batch?: boolean;
    limit?: number;
    [key: string]: unknown;
  }): Promise<{ type: string; [key: string]: unknown }[]> {
    const limit = opts.limit ?? 10;

    // Batch mode: return priority list of payloads needing profiles
    if (opts.batch) {
      const result = await this.db.execute<{
        type: string;
        [key: string]: unknown;
      }>(sql`
        SELECT
          'batch_target' AS type,
          p.id AS "payloadId",
          p.name AS "payloadName",
          p.profile_confidence AS "profileConfidence",
          p.technical_profile->>'lastUpdated' AS "lastUpdated",
          COUNT(sp.satellite_id)::int AS "satelliteCount"
        FROM payload p
        LEFT JOIN satellite_payload sp ON sp.payload_id = p.id
        WHERE p.profile_confidence IS DISTINCT FROM -1
        GROUP BY p.id
        ORDER BY
          CASE
            WHEN p.profile_confidence IS NULL THEN 0
            WHEN p.profile_confidence < 0.75 THEN 1
            ELSE 2
          END,
          COUNT(sp.satellite_id) DESC
        LIMIT ${limit}
      `);
      return result.rows;
    }

    // Single payload mode
    const rawName =
      (opts.payloadName as string) ??
      (opts.payloadKind as string) ??
      (opts.payload_name as string) ??
      (opts.payload_kind as string) ??
      (opts.payload as string) ??
      (opts.name as string) ??
      "";
    const searchName = rawName.replace(/\s+[A-Z]{1,3}$/, "").trim();
    const payloadFilter = opts.payloadId
      ? sql`p.id = ${opts.payloadId}`
      : sql`similarity(lower(p.name), lower(${searchName})) > 0.15`;

    const results: { type: string; [key: string]: unknown }[] = [];

    // 1. Payload identity + existing profile
    const identityResult = await this.db.execute<{
      type: string;
      payloadId: unknown;
      [key: string]: unknown;
    }>(sql`
      SELECT
        'identity' AS type,
        p.id AS "payloadId",
        p.name,
        p.technical_profile AS "existingProfile",
        p.profile_confidence AS "profileConfidence",
        p.photo_url AS "photoUrl"
      FROM payload p
      WHERE ${payloadFilter}
      ORDER BY similarity(lower(p.name), lower(${searchName})) DESC
      LIMIT 1
    `);
    const identity = identityResult.rows[0];
    if (identity) results.push(identity);

    const payloadId = identity?.payloadId;
    if (!payloadId) return results;

    // 2. Satellite distribution
    const satelliteStats = await this.db.execute<{
      type: string;
      [key: string]: unknown;
    }>(sql`
      SELECT
        'satellite_distribution' AS type,
        COUNT(*)::int AS "totalSatellites",
        sp.role,
        oc.name AS "operatorCountryName",
        orr.name AS "orbitRegimeName"
      FROM satellite_payload sp
      JOIN satellite s ON s.id = sp.satellite_id
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
      WHERE sp.payload_id = ${payloadId}
      GROUP BY sp.role, oc.name, orr.name
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);
    results.push(...satelliteStats.rows);

    // 3. Payload role / mass / power allocation per operator country
    const allocationData = await this.db.execute<{
      type: string;
      [key: string]: unknown;
    }>(sql`
      SELECT DISTINCT
        'payload_allocation' AS type,
        oc.name AS "operatorCountryName",
        orr.name AS "orbitRegimeName",
        sp.role,
        sp.mass_kg AS "massKg",
        sp.power_w AS "powerW"
      FROM satellite_payload sp
      JOIN satellite s ON s.id = sp.satellite_id
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
      WHERE sp.payload_id = ${payloadId}
        AND sp.role IS NOT NULL
      GROUP BY oc.name, orr.name, sp.role, sp.mass_kg, sp.power_w
      ORDER BY sp.role, oc.name
      LIMIT 20
    `);
    results.push(...allocationData.rows);

    // 4. Existing research findings about this payload
    const findings = await this.db.execute<{
      type: string;
      [key: string]: unknown;
    }>(sql`
      SELECT
        'prior_finding' AS type,
        rf.title,
        rf.summary,
        rf.confidence,
        rf.finding_type AS "findingType",
        rf.created_at AS "createdAt"
      FROM research_edge re
      JOIN research_finding rf ON rf.id = re.finding_id
      WHERE re.entity_type = 'payload'
        AND re.entity_id = ${payloadId}
        AND rf.status = 'active'
      ORDER BY rf.confidence DESC
      LIMIT 5
    `);
    results.push(...findings.rows);

    return results;
  }

  /** Catalog ingestion view with operator / country / platform / regime. */ // ← absorbed from cortices/queries/catalog.ts
  async listCatalogContext(
    opts: { source?: string; sinceEpoch?: string; limit?: number } = {},
  ): Promise<
    Array<{
      satelliteId: number;
      name: string;
      noradId: number | null;
      operator: string | null;
      operatorCountry: string | null;
      platformClass: string | null;
      orbitRegime: string | null;
      launchYear: number | null;
      ingestedAt: string;
    }>
  > {
    const sinceFilter = opts.sinceEpoch
      ? sql`AND s.created_at > ${opts.sinceEpoch}::timestamptz`
      : sql``;

    const results = await this.db.execute(sql`
      SELECT
        s.id::int AS "satelliteId",
        s.name,
        NULLIF(s.telemetry_summary->>'noradId', '')::int AS "noradId",
        op.name AS "operator",
        oc.name AS "operatorCountry",
        pc.name AS "platformClass",
        orr.name AS "orbitRegime",
        s.launch_year AS "launchYear",
        s.created_at::text AS "ingestedAt"
      FROM satellite s
      LEFT JOIN operator op            ON op.id  = s.operator_id
      LEFT JOIN operator_country oc    ON oc.id  = s.operator_country_id
      LEFT JOIN platform_class pc      ON pc.id  = s.platform_class_id
      LEFT JOIN orbit_regime orr       ON orr.id = oc.orbit_regime_id
      WHERE 1 = 1
        ${sinceFilter}
      ORDER BY s.created_at DESC
      LIMIT ${opts.limit ?? 50}
    `);

    return results.rows as unknown as Array<{
      satelliteId: number;
      name: string;
      noradId: number | null;
      operator: string | null;
      operatorCountry: string | null;
      platformClass: string | null;
      orbitRegime: string | null;
      launchYear: number | null;
      ingestedAt: string;
    }>;
  }

  /** Full satellite lookup by id with all joins. */ // ← absorbed from cortices/queries/satellite.ts
  async findByIdFull(
    id: bigint | number,
  ): Promise<{
    id: bigint;
    name: string;
    slug: string;
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
  } | null> {
    const results = await this.db.execute(sql`
      SELECT
        s.id, s.name, s.slug,
        s.launch_year as "launchYear",
        op.name as "operatorName", op.id as "operatorId",
        oc.name as "operatorCountryName", oc.id as "operatorCountryId",
        pc.name as "platformClassName", pc.id as "platformClassId",
        orr.name as "orbitRegimeName", orr.id as "orbitRegimeId",
        s.telemetry_summary as "telemetrySummary"
      FROM satellite s
      LEFT JOIN operator op ON op.id = s.operator_id
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
      LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
      WHERE s.id = ${BigInt(id)}
      LIMIT 1
    `);

    const row = results.rows[0];
    return row
      ? (row as unknown as {
          id: bigint;
          name: string;
          slug: string;
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
        })
      : null;
  }

  /** List satellites by operator name. */ // ← absorbed from cortices/queries/satellite.ts
  async listByOperator(
    opts: { operator?: string; limit?: number },
  ): Promise<
    Array<{
      id: bigint;
      name: string;
      slug: string;
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
    }>
  > {
    const operatorFilter = opts.operator
      ? sql`AND op.name = ${opts.operator}`
      : sql``;

    const results = await this.db.execute(sql`
      SELECT
        s.id, s.name, s.slug,
        s.launch_year as "launchYear",
        op.name as "operatorName", op.id as "operatorId",
        oc.name as "operatorCountryName", oc.id as "operatorCountryId",
        pc.name as "platformClassName", pc.id as "platformClassId",
        orr.name as "orbitRegimeName", orr.id as "orbitRegimeId",
        s.telemetry_summary as "telemetrySummary"
      FROM satellite s
      LEFT JOIN operator op ON op.id = s.operator_id
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
      LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
      WHERE 1 = 1
        ${operatorFilter}
      ORDER BY s.launch_year DESC NULLS LAST, s.name ASC
      LIMIT ${opts.limit ?? 200}
    `);

    return results.rows as unknown as Array<{
      id: bigint;
      name: string;
      slug: string;
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
    }>;
  }

  /** Mission windows with EOL projections. */ // ← absorbed from cortices/queries/satellite.ts
  async listMissionWindows(
    opts: { orbitRegime?: string; limit?: number },
  ): Promise<
    Array<{
      id: bigint;
      name: string;
      slug: string;
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

    const results = await this.db.execute(sql`
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
        LEFT JOIN operator op ON op.id = s.operator_id
        LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
        LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
        LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
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

    return results.rows as unknown as Array<{
      id: bigint;
      name: string;
      slug: string;
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
    }>;
  }

  /** Per-regime data quality audit. */ // ← absorbed from cortices/queries/data-audit.ts
  async auditDataCompleteness(
    opts: { orbitRegime?: string; limit?: number } = {},
  ): Promise<
    Array<{
      regimeId: string | null;
      regimeName: string | null;
      satellitesInRegime: number;
      missingMass: number;
      missingLaunchYear: number;
      outOfRangeLaunchYear: number;
      missingOperator: number;
      missingOperatorCountry: number;
      missingPlatformClass: number;
      missingTelemetrySummary: number;
      avgTelemetryScalarNullCount: number;
      flaggedCount: number;
    }>
  > {
    const limit = opts.limit ?? 20;
    const regimeFilter = opts.orbitRegime
      ? sql`AND orr.name = ${opts.orbitRegime}`
      : sql``;

    const results = await this.db.execute(sql`
      WITH base AS (
        SELECT
          orr.id AS regime_id,
          orr.name AS regime_name,
          s.id AS satellite_id,
          s.mass_kg,
          s.launch_year,
          s.operator_id,
          s.operator_country_id,
          s.platform_class_id,
          s.telemetry_summary,
          (CASE WHEN s.power_draw IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.thermal_margin IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.pointing_accuracy IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.attitude_rate IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.link_budget IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.data_rate IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.payload_duty IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.eclipse_ratio IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.solar_array_health IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.battery_depth_of_discharge IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.propellant_remaining IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.radiation_dose IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.debris_proximity IS NULL THEN 1 ELSE 0 END
           + CASE WHEN s.mission_age IS NULL THEN 1 ELSE 0 END)::int AS tel_null_count
        FROM satellite s
        LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
        LEFT JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
        WHERE 1=1 ${regimeFilter}
      ),
      flagged AS (
        SELECT
          regime_id,
          satellite_id,
          ((CASE WHEN mass_kg IS NULL OR mass_kg <= 0 THEN 1 ELSE 0 END)
           + (CASE WHEN launch_year IS NULL THEN 1 ELSE 0 END)
           + (CASE WHEN launch_year IS NOT NULL AND (launch_year < 1957 OR launch_year > 2030) THEN 1 ELSE 0 END)
           + (CASE WHEN operator_id IS NULL THEN 1 ELSE 0 END)
           + (CASE WHEN operator_country_id IS NULL THEN 1 ELSE 0 END)
           + (CASE WHEN platform_class_id IS NULL THEN 1 ELSE 0 END)
           + (CASE WHEN telemetry_summary IS NULL OR jsonb_typeof(telemetry_summary) = 'null' THEN 1 ELSE 0 END)
           + (CASE WHEN tel_null_count >= 7 THEN 1 ELSE 0 END)) AS issue_count
        FROM base
      )
      SELECT
        b.regime_id::text AS "regimeId",
        b.regime_name AS "regimeName",
        count(*)::int AS "satellitesInRegime",
        sum(CASE WHEN b.mass_kg IS NULL OR b.mass_kg <= 0 THEN 1 ELSE 0 END)::int AS "missingMass",
        sum(CASE WHEN b.launch_year IS NULL THEN 1 ELSE 0 END)::int AS "missingLaunchYear",
        sum(CASE WHEN b.launch_year IS NOT NULL AND (b.launch_year < 1957 OR b.launch_year > 2030) THEN 1 ELSE 0 END)::int AS "outOfRangeLaunchYear",
        sum(CASE WHEN b.operator_id IS NULL THEN 1 ELSE 0 END)::int AS "missingOperator",
        sum(CASE WHEN b.operator_country_id IS NULL THEN 1 ELSE 0 END)::int AS "missingOperatorCountry",
        sum(CASE WHEN b.platform_class_id IS NULL THEN 1 ELSE 0 END)::int AS "missingPlatformClass",
        sum(CASE WHEN b.telemetry_summary IS NULL OR jsonb_typeof(b.telemetry_summary) = 'null' THEN 1 ELSE 0 END)::int AS "missingTelemetrySummary",
        COALESCE(avg(b.tel_null_count)::numeric(5,2), 0)::float AS "avgTelemetryScalarNullCount",
        (SELECT count(*)::int FROM flagged f WHERE f.regime_id IS NOT DISTINCT FROM b.regime_id AND f.issue_count >= 3) AS "flaggedCount"
      FROM base b
      GROUP BY b.regime_id, b.regime_name
      ORDER BY "satellitesInRegime" DESC
      LIMIT ${limit}
    `);

    type AuditRow = {
      regimeId: string | null;
      regimeName: string | null;
      satellitesInRegime: number;
      missingMass: number;
      missingLaunchYear: number;
      outOfRangeLaunchYear: number;
      missingOperator: number;
      missingOperatorCountry: number;
      missingPlatformClass: number;
      missingTelemetrySummary: number;
      avgTelemetryScalarNullCount: number;
      flaggedCount: number;
    };

    return (results.rows as unknown as AuditRow[]).map((r) => ({
      ...r,
      regimeId: r.regimeId == null ? null : String(r.regimeId),
    }));
  }

  /** Classification anomaly flags. */ // ← absorbed from cortices/queries/classification-audit.ts
  async auditClassification(
    opts: { limit?: number } = {},
  ): Promise<
    Array<{
      satelliteId: string;
      satelliteName: string;
      operatorName: string | null;
      platformClass: string | null;
      classificationTier: string | null;
      launchYear: number | null;
      massKg: number | null;
      flag: string;
      details: string;
    }>
  > {
    const limit = opts.limit ?? 50;

    const results = await this.db.execute(sql`
      WITH base AS (
        SELECT
          s.id,
          s.name,
          s.classification_tier,
          s.launch_year,
          s.mass_kg,
          s.mission_age,
          s.is_experimental,
          s.rating,
          op.name AS operator_name,
          pc.name AS platform_class
        FROM satellite s
        LEFT JOIN operator op ON op.id = s.operator_id
        LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
      ),
      missing_tier AS (
        SELECT id, name, operator_name, platform_class, classification_tier, launch_year, mass_kg,
          'missing_tier'::text AS flag,
          'classification_tier is NULL'::text AS details
        FROM base WHERE classification_tier IS NULL
      ),
      eo_mass_outlier AS (
        SELECT id, name, operator_name, platform_class, classification_tier, launch_year, mass_kg,
          'eo_mass_outlier'::text AS flag,
          ('EO satellite mass ' || mass_kg::int || 'kg exceeds 5000kg threshold')::text AS details
        FROM base
        WHERE mass_kg IS NOT NULL AND mass_kg > 5000 AND platform_class = 'earth_observation'
      ),
      temporal_impossible AS (
        SELECT id, name, operator_name, platform_class, classification_tier, launch_year, mass_kg,
          'temporal_impossible'::text AS flag,
          ('launch_year=' || launch_year || ' but mission_age=' || mission_age::numeric(6,2))::text AS details
        FROM base
        WHERE launch_year IS NOT NULL AND launch_year < 1990
          AND mission_age IS NOT NULL AND mission_age < 5
      ),
      experimental_high_rating AS (
        SELECT id, name, operator_name, platform_class, classification_tier, launch_year, mass_kg,
          'experimental_high_rating'::text AS flag,
          ('is_experimental=TRUE but rating=' || rating::numeric(4,2))::text AS details
        FROM base
        WHERE is_experimental IS TRUE AND rating IS NOT NULL AND rating > 0.9
      ),
      unioned AS (
        SELECT * FROM missing_tier
        UNION ALL SELECT * FROM eo_mass_outlier
        UNION ALL SELECT * FROM temporal_impossible
        UNION ALL SELECT * FROM experimental_high_rating
      )
      SELECT
        id::text AS "satelliteId",
        name AS "satelliteName",
        operator_name AS "operatorName",
        platform_class AS "platformClass",
        classification_tier AS "classificationTier",
        launch_year AS "launchYear",
        mass_kg AS "massKg",
        flag,
        details
      FROM unioned
      ORDER BY flag, "satelliteName"
      LIMIT ${limit}
    `);

    type ClassRow = {
      satelliteId: string;
      satelliteName: string;
      operatorName: string | null;
      platformClass: string | null;
      classificationTier: string | null;
      launchYear: number | null;
      massKg: number | null;
      flag: string;
      details: string;
    };

    return (results.rows as unknown as ClassRow[]).map((r) => ({
      ...r,
      satelliteId: String(r.satelliteId),
    }));
  }

  /** Apogee / orbit-manoeuvre news + satellite TLE context. */ // ← absorbed from cortices/queries/apogee.ts
  async listApogeeHistory(
    opts: {
      noradId?: string | number;
      windowDays?: number;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      kind: "news" | "satellite";
      title: string;
      summary: string | null;
      url: string | null;
      publishedAt: string | null;
      noradId: number | null;
      meanMotion: number | null;
      inclination: number | null;
      eccentricity: number | null;
    }>
  > {
    type ApogeeRow = {
      kind: "news" | "satellite";
      title: string;
      summary: string | null;
      url: string | null;
      publishedAt: string | null;
      noradId: number | null;
      meanMotion: number | null;
      inclination: number | null;
      eccentricity: number | null;
    };

    const perBranchLimit = Math.max(3, Math.ceil((opts.limit ?? 15) / 2));
    const totalLimit = opts.limit ?? 15;
    const norad = opts.noradId != null ? String(opts.noradId) : null;

    const newsRows = await this.db.execute(sql`
      SELECT
        'news'::text            AS "kind",
        si.title                AS "title",
        si.abstract             AS "summary",
        si.url                  AS "url",
        si.published_at::text   AS "publishedAt",
        NULL::int               AS "noradId",
        NULL::real              AS "meanMotion",
        NULL::real              AS "inclination",
        NULL::real              AS "eccentricity"
      FROM source_item si
      WHERE
        si.title    ILIKE '%TLE%'
        OR si.title ILIKE '%apogee%'
        OR si.title ILIKE '%perigee%'
        OR si.title ILIKE '%decay%'
        OR si.title ILIKE '%orbit raise%'
      ORDER BY si.published_at DESC NULLS LAST
      LIMIT ${perBranchLimit}
    `);

    const satRows = norad
      ? await this.db.execute(sql`
          SELECT
            'satellite'::text                                        AS "kind",
            s.name                                                   AS "title",
            s.g_short_description                                    AS "summary",
            NULL::text                                               AS "url",
            s.created_at::text                                       AS "publishedAt",
            NULLIF(s.telemetry_summary->>'noradId','')::int          AS "noradId",
            NULLIF(s.telemetry_summary->>'meanMotion','')::real      AS "meanMotion",
            NULLIF(s.telemetry_summary->>'inclination','')::real     AS "inclination",
            NULLIF(s.telemetry_summary->>'eccentricity','')::real    AS "eccentricity"
          FROM satellite s
          WHERE s.telemetry_summary->>'noradId' = ${norad}
          LIMIT 1
        `)
      : { rows: [] as unknown[] };

    const combined = [
      ...(newsRows.rows as unknown as ApogeeRow[]),
      ...(satRows.rows as unknown as ApogeeRow[]),
    ].slice(0, totalLimit);

    return combined;
  }

  /** Heuristic replacement cost estimate for a satellite. */ // ← absorbed from cortices/queries/replacement-cost.ts
  async estimateReplacementCost(
    opts: { satelliteId: string | number | bigint },
  ): Promise<
    Array<{
      satelliteId: number;
      name: string;
      operatorName: string | null;
      massKg: number | null;
      busName: string | null;
      payloadNames: string[];
      estimatedCost: { low: number; mid: number; high: number; currency: "USD" };
      breakdown: { bus: number; payload: number; launch: number };
    }>
  > {
    if (opts.satelliteId == null) return [];

    const FALLBACK_MASS_KG = 500;
    const USD_PER_KG_BUS = 50_000;
    const USD_PER_PAYLOAD_FIXED = 10_000_000;
    const USD_PER_KG_LAUNCH = 10_000;

    const results = await this.db.execute(sql`
      SELECT
        s.id::int           AS "satelliteId",
        s.name,
        op.name             AS "operatorName",
        s.mass_kg           AS "massKg",
        sb.name             AS "busName",
        (
          SELECT array_agg(p.name ORDER BY p.name)
          FROM satellite_payload sp
          JOIN payload p ON p.id = sp.payload_id
          WHERE sp.satellite_id = s.id
        )                   AS "payloadNames"
      FROM satellite s
      LEFT JOIN operator op    ON op.id = s.operator_id
      LEFT JOIN satellite_bus sb ON sb.id = s.satellite_bus_id
      WHERE s.id = ${BigInt(opts.satelliteId as string | number)}
      LIMIT 1
    `);

    type RawRow = {
      satelliteId: number;
      name: string;
      operatorName: string | null;
      massKg: number | null;
      busName: string | null;
      payloadNames: string[] | null;
    };

    const row = results.rows[0] as unknown as RawRow | undefined;
    if (!row) return [];

    const massKg = row.massKg ?? FALLBACK_MASS_KG;
    const payloadNames = row.payloadNames ?? [];
    const bus = massKg * USD_PER_KG_BUS;
    const payload = Math.max(payloadNames.length, 1) * USD_PER_PAYLOAD_FIXED;
    const launch = massKg * USD_PER_KG_LAUNCH;
    const mid = bus + payload + launch;

    return [
      {
        satelliteId: row.satelliteId,
        name: row.name,
        operatorName: row.operatorName,
        massKg: row.massKg,
        busName: row.busName,
        payloadNames,
        estimatedCost: {
          low: Math.round(mid * 0.7),
          mid: Math.round(mid),
          high: Math.round(mid * 1.3),
          currency: "USD",
        },
        breakdown: {
          bus: Math.round(bus),
          payload: Math.round(payload),
          launch: Math.round(launch),
        },
      },
    ];
  }
}

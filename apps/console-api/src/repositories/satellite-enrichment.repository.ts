import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  CatalogContextRow,
  ReplacementCostRawRow,
  LaunchCostRow,
  PayloadContextRow,
} from "../types/satellite.types";

export type {
  CatalogContextRow,
  ReplacementCostRawRow,
  LaunchCostRow,
  PayloadContextRow,
} from "../types/satellite.types";

export class SatelliteEnrichmentRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /** Catalog ingestion view with operator / country / platform / regime. */
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
      LEFT JOIN operator op            ON op.id  = s.operator_id
      LEFT JOIN operator_country oc    ON oc.id  = s.operator_country_id
      LEFT JOIN platform_class pc      ON pc.id  = s.platform_class_id
      LEFT JOIN orbit_regime orr       ON orr.id = oc.orbit_regime_id
      WHERE 1 = 1
        ${sinceFilter}
      ORDER BY s.created_at DESC
      LIMIT ${opts.limit ?? 50}
    `);

    return results.rows;
  }

  /** Raw bus/payload context for replacement-cost estimation. Math lives in the service. */
  async findReplacementCostInputs(
    opts: { satelliteId: string | number | bigint },
  ): Promise<ReplacementCostRawRow[]> {
    if (opts.satelliteId == null) return [];

    type NullablePayloads = Omit<ReplacementCostRawRow, "payloadNames"> & {
      payloadNames: string[] | null;
    };

    const results = await this.db.execute<NullablePayloads>(sql`
      SELECT
        s.id::int           AS "satelliteId",
        s.name,
        s.norad_id          AS "noradId",
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

    const row = results.rows[0];
    if (!row) return [];
    return [{ ...row, payloadNames: row.payloadNames ?? [] }];
  }

  /** Launch cost context for the Launch-Cost cortex. */
  async getLaunchCostContext(opts: {
    orbitRegime?: string;
    minLaunchCost?: number;
    maxLaunchCost?: number;
    limit?: number;
  }): Promise<LaunchCostRow[]> {
    const limit = opts.limit ?? 50;
    const regimeFilter = opts.orbitRegime
      ? sql`AND orr.name = ${opts.orbitRegime}`
      : sql``;
    let costFilter = sql``;
    if (opts.minLaunchCost)
      costFilter = sql`${costFilter} AND s.launch_cost >= ${opts.minLaunchCost}`;
    if (opts.maxLaunchCost)
      costFilter = sql`${costFilter} AND s.launch_cost <= ${opts.maxLaunchCost}`;

    const results = await this.db.execute<LaunchCostRow>(sql`
      SELECT
        s.id::text, s.name,
        s.norad_id AS "noradId",
        s.launch_cost as "launchCost",
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
        NULL::real as "solarFluxIndex",
        NULL::real as "kpIndex",
        NULL::real as "radiationIndex",
        COALESCE(manifest.src_count, 0)::int as "manifestSourceCount"
      FROM satellite s
      JOIN operator_country oc ON oc.id = s.operator_country_id
      JOIN orbit_regime orr ON orr.id = oc.orbit_regime_id
      LEFT JOIN platform_class pc ON pc.id = s.platform_class_id
      LEFT JOIN satellite_bus sb ON sb.id = s.satellite_bus_id
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

  /** Cosine similarity search on the catalog embedding vector. */
  async searchByTelemetry(
    profile: number[],
    opts: { orbitRegime?: string; limit?: number },
  ): Promise<
    {
      id: bigint;
      name: string;
      noradId: number | null;
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
      noradId: number | null;
      massKg: number | null;
      operatorCountryName: string;
      orbitRegimeName: string;
      similarity: number;
    }>(sql`
      SELECT s.id, s.name,
        s.norad_id AS "noradId",
        s.mass_kg as "massKg",
        oc.name as "operatorCountryName", orb.name as "orbitRegimeName",
        1.0 - (s.embedding <=> ${JSON.stringify(profile)}::halfvec(2048)) as similarity
      FROM satellite s
      JOIN operator_country oc ON oc.id = s.operator_country_id
      JOIN orbit_regime orb ON orb.id = oc.orbit_regime_id
      WHERE s.embedding IS NOT NULL
        ${orbitRegimeFilter}
      ORDER BY s.embedding <=> ${JSON.stringify(profile)}::halfvec(2048)
      LIMIT ${opts.limit ?? 20}
    `);
    return results.rows;
  }

  /** Payload context for the Payload-Profiler cortex. */
  async getPayloadContext(opts: {
    payloadId?: number | bigint;
    payloadName?: string;
    payloadKind?: string;
    batch?: boolean;
    limit?: number;
    [key: string]: unknown;
  }): Promise<PayloadContextRow[]> {
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
          CASE
            WHEN p.technical_profile IS NULL
              OR jsonb_typeof(p.technical_profile) = 'null'
              THEN NULL::real
            ELSE 1::real
          END AS "profileConfidence",
          p.technical_profile->>'lastUpdated' AS "lastUpdated",
          COUNT(sp.satellite_id)::int AS "satelliteCount"
        FROM payload p
        LEFT JOIN satellite_payload sp ON sp.payload_id = p.id
        GROUP BY p.id
        ORDER BY
          CASE
            WHEN p.technical_profile IS NULL
              OR jsonb_typeof(p.technical_profile) = 'null'
              THEN 0
            ELSE 1
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
        CASE
          WHEN p.technical_profile IS NULL
            OR jsonb_typeof(p.technical_profile) = 'null'
            THEN NULL::real
          ELSE 1::real
        END AS "profileConfidence",
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
}

/**
 * SatelliteRepository — Unified satellite data access (Drizzle only)
 */

import { eq, and, sql, isNull, count } from "drizzle-orm";
import {
  satellite,
  operatorCountry,
  platformClass,
  operator,
  payload,
  satellitePayload,
  satelliteBus,
  orbitRegime,
  type Database,
} from "@interview/db-schema";
import type { NewSatellite as DrizzleNewSatellite } from "@interview/db-schema";
import { toSlug } from "@interview/shared/utils";
import type { TelemetryScalars } from "../types/satellite.types";
import type { CorrectionEntry } from "../utils/doctrine-parser";
import { createLogger } from "@interview/shared/observability";
import { escapeIlike } from "../utils/sql-helpers";

const logger = createLogger("satellite-repository");

/** 14D telemetry field keys (single source of truth) */
const TELEMETRY_14D_KEYS = [
  "powerDraw",
  "thermalMargin",
  "pointingAccuracy",
  "attitudeRate",
  "linkBudget",
  "dataRate",
  "payloadDuty",
  "eclipseRatio",
  "solarArrayHealth",
  "batteryDepthOfDischarge",
  "propellantRemaining",
  "radiationDose",
  "debrisProximity",
  "missionAge",
] as const;

type Telemetry14dKey = (typeof TELEMETRY_14D_KEYS)[number];

/** Build a Drizzle select object for 14D telemetry fields */
function telemetrySelect<T extends Record<Telemetry14dKey, unknown>>(
  table: T,
): Record<Telemetry14dKey, T[Telemetry14dKey]> {
  const obj = {} as Record<Telemetry14dKey, T[Telemetry14dKey]>;
  for (const key of TELEMETRY_14D_KEYS) obj[key] = table[key];
  return obj;
}

/** Extract telemetry values from a flat row into a nested object */
function extractTelemetry(
  row: Record<string, unknown>,
): Record<Telemetry14dKey, number | null> {
  const out = {} as Record<Telemetry14dKey, number | null>;
  for (const key of TELEMETRY_14D_KEYS) out[key] = row[key] as number | null;
  return out;
}

// -- Types ------------------------------------------------------------------

export interface OperatorCountryRow {
  id: bigint;
  name: string;
  orbitRegimeId: bigint | null;
  bounds?: unknown;
  centroid?: unknown;
}
export interface PlatformClassRow {
  id: bigint;
  name: string;
}
export interface OperatorRow {
  id: bigint;
  name: string;
}
export interface PayloadRow {
  id: bigint;
  name: string;
}
export interface SuspectSatelliteRow {
  id: bigint;
  name: string;
  operatorCountryName: string | null;
  operatorCountryId: bigint | null;
}
export interface BusTelemetryRow extends TelemetryScalars {
  id: bigint;
  name: string;
}
export interface InsertedSatellite {
  id: bigint;
  slug: string;
}

// -- Shared select shapes ---------------------------------------------------

const satelliteJoinNames = {
  operatorCountryName: operatorCountry.name,
  platformClassName: platformClass.name,
  operatorName: operator.name,
  orbitRegimeName: orbitRegime.name,
} as const;

const satelliteListSelect = {
  id: satellite.id,
  name: satellite.name,
  slug: satellite.slug,
  massKg: satellite.massKg,
  launchYear: satellite.launchYear,
  isExperimental: satellite.isExperimental,
  rating: satellite.rating,
  photoUrl: satellite.photoUrl,
  ...satelliteJoinNames,
  createdAt: satellite.createdAt,
  updatedAt: satellite.updatedAt,
} as const;

const satelliteDetailSelect = {
  ...satelliteListSelect,
  temperature: satellite.temperature,
  lifetime: satellite.lifetime,
  power: satellite.power,
  rating: satellite.rating,
  photoUrl: satellite.photoUrl,
  ...telemetrySelect(satellite),
} as const;

// ---------------------------------------------------------------------------

export class SatelliteRepository {
  constructor(private db: Database) {}

  // -- Private helpers ------------------------------------------------------

  /** Normalized name lookup: lower(unaccent(col)) = lower(unaccent(input)) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findByName(tbl: any, name: string, useUnaccent = true) {
    const cond = useUnaccent
      ? sql`lower(unaccent(${tbl.name})) = lower(unaccent(${name}))`
      : sql`lower(${tbl.name}) = lower(${name})`;
    const [row] = await this.db
      .select({ id: tbl.id, name: tbl.name })
      .from(tbl)
      .where(cond)
      .limit(1);
    return (row as { id: bigint; name: string } | undefined) ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle query builder internals
  private applySatelliteJoins<T>(qb: T): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (qb as any)
      .leftJoin(
        operatorCountry,
        eq(satellite.operatorCountryId, operatorCountry.id),
      )
      .leftJoin(platformClass, eq(satellite.platformClassId, platformClass.id))
      .leftJoin(operator, eq(satellite.operatorId, operator.id))
      .leftJoin(orbitRegime, eq(operatorCountry.orbitRegimeId, orbitRegime.id));
  }

  // -- Satellite matching ---------------------------------------------------

  async findByExactMatch(
    operatorCountryName: string,
    platformClassName: string,
    launchYear: number,
  ): Promise<{ id: bigint; name: string } | null> {
    try {
      const [row] = await this.db
        .select({ id: satellite.id, name: satellite.name })
        .from(satellite)
        .innerJoin(
          operatorCountry,
          eq(satellite.operatorCountryId, operatorCountry.id),
        )
        .innerJoin(
          platformClass,
          eq(satellite.platformClassId, platformClass.id),
        )
        .where(
          and(
            eq(satellite.launchYear, launchYear),
            sql`lower(${operatorCountry.name}) = lower(${operatorCountryName})`,
            sql`lower(${platformClass.name}) = lower(${platformClassName})`,
          ),
        )
        .limit(1);
      return row ?? null;
    } catch (error) {
      logger.warn({ error }, "Exact match query failed");
      return null;
    }
  }

  async findByVector(
    vector: number[],
    platformClassFilter?: string,
    limit = 5,
  ): Promise<Array<{ id: bigint; name: string; cosineDistance: number }>> {
    try {
      const v = `[${vector.join(",")}]`;
      const platformClassClause = platformClassFilter
        ? sql`AND lower(pc.name) = lower(${platformClassFilter})`
        : sql``;
      const results = await this.db.execute<{
        id: bigint;
        name: string;
        cosine_distance: number;
      }>(sql`
        SELECT s.id, s.name,
               s.embedding_search <=> ${v}::vector AS cosine_distance
        FROM satellite s LEFT JOIN platform_class pc ON s.platform_class_id = pc.id
        WHERE s.embedding_search IS NOT NULL ${platformClassClause}
        ORDER BY s.embedding_search <=> ${v}::vector
        LIMIT ${limit}
      `);
      return (results.rows || []).map((r) => ({
        id: BigInt(String(r.id)),
        name: String(r.name),
        cosineDistance: Number(r.cosine_distance),
      }));
    } catch (error) {
      logger.warn({ err: error }, "Vector search failed");
      return [];
    }
  }

  async batchExactMatch(
    inputs: Array<{
      operatorCountry: string;
      platformClass: string;
      launchYear: number;
    }>,
  ): Promise<
    Array<{
      id: bigint;
      name: string;
      operatorCountryName: string;
      platformClassName: string;
      launchYear: number | null;
    }>
  > {
    if (inputs.length === 0) return [];
    try {
      const conditions = inputs.map(
        (i) =>
          sql`(${satellite.launchYear} = ${i.launchYear} AND lower(${operatorCountry.name}) = lower(${i.operatorCountry}) AND lower(${platformClass.name}) = lower(${i.platformClass}))`,
      );
      const rows = await this.db
        .select({
          id: satellite.id,
          name: satellite.name,
          platformClassName: platformClass.name,
          operatorCountryName: operatorCountry.name,
          launchYear: satellite.launchYear,
        })
        .from(satellite)
        .innerJoin(
          operatorCountry,
          eq(satellite.operatorCountryId, operatorCountry.id),
        )
        .innerJoin(
          platformClass,
          eq(satellite.platformClassId, platformClass.id),
        )
        .where(sql.join(conditions, sql` OR `));
      logger.info(
        { inputs: inputs.length, matched: rows.length },
        "Batch exact match complete",
      );
      return rows;
    } catch (error) {
      logger.warn({ error, count: inputs.length }, "Batch exact match failed");
      return [];
    }
  }

  // -- Single lookups -------------------------------------------------------

  async findById(id: bigint): Promise<{ id: bigint; name: string } | null> {
    const [r] = await this.db
      .select({ id: satellite.id, name: satellite.name })
      .from(satellite)
      .where(eq(satellite.id, id))
      .limit(1);
    return r ?? null;
  }

  async findSatelliteByName(name: string): Promise<{
    id: bigint;
    name: string;
    operatorCountryId: bigint | null;
  } | null> {
    const [row] = await this.db
      .select({
        id: satellite.id,
        name: satellite.name,
        operatorCountryId: satellite.operatorCountryId,
      })
      .from(satellite)
      .where(sql`lower(unaccent(${satellite.name})) = lower(unaccent(${name}))`)
      .limit(1);
    return row ?? null;
  }

  async slugExists(slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: satellite.id })
      .from(satellite)
      .where(eq(satellite.slug, slug))
      .limit(1);
    return !!row;
  }

  // -- FK lookups (pipeline) ------------------------------------------------

  async findOperatorCountry(name: string): Promise<OperatorCountryRow | null> {
    const [row] = await this.db
      .select({
        id: operatorCountry.id,
        name: operatorCountry.name,
        orbitRegimeId: operatorCountry.orbitRegimeId,
        bounds: operatorCountry.bounds,
        centroid: operatorCountry.centroid,
      })
      .from(operatorCountry)
      .where(
        sql`lower(unaccent(${operatorCountry.name})) = lower(unaccent(${name}))`,
      )
      .limit(1);
    return row ?? null;
  }

  async findOperatorCountryGeometry(
    name: string,
  ): Promise<{ geometry: unknown; bounds: unknown; centroid: unknown } | null> {
    const [row] = await this.db
      .select({
        geometry: operatorCountry.geometry,
        bounds: operatorCountry.bounds,
        centroid: operatorCountry.centroid,
      })
      .from(operatorCountry)
      .where(
        sql`lower(unaccent(${operatorCountry.name})) = lower(unaccent(${name}))`,
      )
      .limit(1);
    return row?.geometry ? row : null;
  }

  /**
   * Get an orbit regime's combined geometry as convex hull of all its operator-country geometries.
   * Also returns the list of operator-country names + centroids for the orbit regime.
   */
  async findOrbitRegimeGeometry(orbitRegimeName: string): Promise<{
    name: string;
    geometry: unknown;
    bounds: {
      min_lat: number;
      max_lat: number;
      min_lon: number;
      max_lon: number;
    };
    operatorCountries: { name: string; centroid: unknown; bounds: unknown }[];
  } | null> {
    // Find the orbit regime
    const [reg] = await this.db
      .select({ id: orbitRegime.id, name: orbitRegime.name })
      .from(orbitRegime)
      .where(
        sql`lower(unaccent(${orbitRegime.name})) = lower(unaccent(${orbitRegimeName}))`,
      )
      .limit(1);

    if (!reg) return null;

    // Get all operator-countries with geometry for this orbit regime
    const ocs = await this.db
      .select({
        name: operatorCountry.name,
        geometry: operatorCountry.geometry,
        bounds: operatorCountry.bounds,
        centroid: operatorCountry.centroid,
      })
      .from(operatorCountry)
      .where(
        and(
          eq(operatorCountry.orbitRegimeId, reg.id),
          sql`${operatorCountry.geometry} IS NOT NULL`,
        ),
      );

    if (!ocs.length) return null;

    // Compute combined bounds from all operator-countries
    let minLat = 90,
      maxLat = -90,
      minLon = 180,
      maxLon = -180;
    for (const oc of ocs) {
      const b = oc.bounds as {
        min_lat: number;
        max_lat: number;
        min_lon: number;
        max_lon: number;
      } | null;
      if (b) {
        minLat = Math.min(minLat, b.min_lat);
        maxLat = Math.max(maxLat, b.max_lat);
        minLon = Math.min(minLon, b.min_lon);
        maxLon = Math.max(maxLon, b.max_lon);
      }
    }

    // Merge all operator-country geometries into a single GeoJSON GeometryCollection
    const mergedGeometry: GeoJSON.GeometryCollection = {
      type: "GeometryCollection",
      geometries: ocs
        .filter((a) => a.geometry)
        .map((a) => a.geometry as GeoJSON.Geometry),
    };

    return {
      name: reg.name,
      geometry: mergedGeometry,
      bounds: {
        min_lat: minLat,
        max_lat: maxLat,
        min_lon: minLon,
        max_lon: maxLon,
      },
      operatorCountries: ocs.map((a) => ({
        name: a.name,
        centroid: a.centroid,
        bounds: a.bounds,
      })),
    };
  }

  /**
   * Find the dominant operator-country for operators matching a search term (trigram).
   * Returns the operator-country with the most satellites across matched operators.
   */
  async findDominantOperatorCountryForOperator(
    operatorSearch: string,
  ): Promise<OperatorCountryRow | null> {
    const rows = await this.db.execute<{
      id: bigint;
      name: string;
      orbit_regime_id: bigint | null;
      bounds: unknown;
      centroid: unknown;
    }>(sql`
      SELECT oc.id, oc.name, oc.orbit_regime_id, oc.bounds, oc.centroid
      FROM satellite s
      JOIN operator op ON op.id = s.operator_id
      JOIN operator_country oc ON oc.id = s.operator_country_id
      WHERE similarity(op.name, ${operatorSearch}) > 0.2
      GROUP BY oc.id, oc.name, oc.orbit_regime_id, oc.bounds, oc.centroid
      ORDER BY count(*) DESC
      LIMIT 1
    `);
    const row = rows.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      orbitRegimeId: row.orbit_regime_id,
      bounds: row.bounds,
      centroid: row.centroid,
    };
  }

  async findAllOperatorCountries(): Promise<
    Array<{ id: bigint; name: string }>
  > {
    return this.db
      .select({ id: operatorCountry.id, name: operatorCountry.name })
      .from(operatorCountry);
  }

  async findOrbitRegime(name: string) {
    return this.findByName(orbitRegime, name);
  }
  async findOperator(name: string) {
    return this.findByName(operator, name) as Promise<OperatorRow | null>;
  }
  async findPayload(name: string) {
    return this.findByName(payload, name, false) as Promise<PayloadRow | null>;
  }

  async loadAllPlatformClasses(): Promise<PlatformClassRow[]> {
    return this.db
      .select({ id: platformClass.id, name: platformClass.name })
      .from(platformClass);
  }

  // -- FK inserts (pipeline) ------------------------------------------------

  async insertOperator(name: string): Promise<OperatorRow> {
    const [row] = await this.db
      .insert(operator)
      .values({ name, slug: toSlug(name) })
      .returning({ id: operator.id, name: operator.name });
    return row;
  }

  async insertPayload(name: string): Promise<PayloadRow> {
    const [row] = await this.db
      .insert(payload)
      .values({ name, slug: toSlug(name) })
      .returning({ id: payload.id, name: payload.name });
    return row;
  }

  async insertOperatorCountry(
    name: string,
    orbitRegimeId: bigint | null,
  ): Promise<OperatorCountryRow> {
    const [row] = await this.db
      .insert(operatorCountry)
      .values({ name, orbitRegimeId, slug: toSlug(name) })
      .returning({
        id: operatorCountry.id,
        name: operatorCountry.name,
        orbitRegimeId: operatorCountry.orbitRegimeId,
      });
    return row;
  }

  // -- Doctrine / SatelliteBus ----------------------------------------------

  async findOperatorCountryDoctrineByName(
    name: string,
  ): Promise<{ name: string; doctrine: Record<string, unknown> } | null> {
    const [row] = await this.db
      .select({ name: operatorCountry.name, doctrine: operatorCountry.doctrine })
      .from(operatorCountry)
      .where(
        sql`lower(unaccent(${operatorCountry.name})) = lower(unaccent(${name}))`,
      )
      .limit(1);
    if (!row?.doctrine) return null;
    return { name: row.name, doctrine: row.doctrine as Record<string, unknown> };
  }

  async getOperatorCountryDoctrine(
    operatorCountryId: bigint,
  ): Promise<Record<string, unknown> | null> {
    const [row] = await this.db
      .select({
        doctrine: operatorCountry.doctrine,
        bounds: operatorCountry.bounds,
      })
      .from(operatorCountry)
      .where(eq(operatorCountry.id, operatorCountryId))
      .limit(1);
    if (!row?.doctrine) return null;
    const doctrine = row.doctrine as Record<string, unknown>;
    if (row.bounds) doctrine._bounds = row.bounds;
    return doctrine;
  }

  async findFrequentBus(
    operatorCountryId: bigint,
    platformClassId: bigint,
  ): Promise<bigint | null> {
    const rows = await this.db
      .select({
        busId: satellite.satelliteBusId,
        count: sql<number>`count(*)`.as("cnt"),
      })
      .from(satellite)
      .where(
        and(
          eq(satellite.operatorCountryId, operatorCountryId),
          eq(satellite.platformClassId, platformClassId),
          sql`${satellite.satelliteBusId} IS NOT NULL`,
        ),
      )
      .groupBy(satellite.satelliteBusId)
      .orderBy(sql`count(*) DESC`)
      .limit(1);
    return rows[0]?.busId ?? null;
  }

  async getBusTelemetry(busId: bigint): Promise<BusTelemetryRow | null> {
    const [row] = await this.db
      .select({
        id: satelliteBus.id,
        name: satelliteBus.name,
        ...telemetrySelect(satelliteBus),
      })
      .from(satelliteBus)
      .where(eq(satelliteBus.id, busId))
      .limit(1);
    return row ?? null;
  }

  // -- Batch insert ---------------------------------------------------------

  async insertSatellitesWithPayloads(
    satellites: DrizzleNewSatellite[],
    payloadLinks: Array<{
      satelliteSlug: string;
      payloadId: bigint;
      role?: string;
      massKg?: number;
      powerW?: number;
    }>,
  ): Promise<InsertedSatellite[]> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(satellite)
        .values(satellites)
        .returning({ id: satellite.id, slug: satellite.slug });
      logger.info({ count: inserted.length }, "Satellites inserted");

      if (payloadLinks.length > 0) {
        const slugToId = new Map(inserted.map((r) => [r.slug, r.id]));
        const values = payloadLinks
          .map((l) => {
            const satelliteId = slugToId.get(l.satelliteSlug);
            return satelliteId
              ? {
                  satelliteId,
                  payloadId: l.payloadId,
                  role: l.role,
                  massKg: l.massKg,
                  powerW: l.powerW,
                }
              : null;
          })
          .filter((v): v is NonNullable<typeof v> => v !== null);

        if (values.length > 0) {
          await tx
            .insert(satellitePayload)
            .values(values)
            .onConflictDoNothing();
          logger.info(
            { count: values.length },
            "satellite_payload links inserted",
          );
        }
      }
      return inserted;
    });
  }

  // -- OperatorCountry scanning ---------------------------------------------

  async findNullOperatorCountrySatellites(
    limit = 1000,
  ): Promise<SuspectSatelliteRow[]> {
    const rows = await this.db
      .select({
        id: satellite.id,
        name: satellite.name,
        operatorCountryName: sql<string | null>`null`,
        operatorCountryId: satellite.operatorCountryId,
      })
      .from(satellite)
      .where(isNull(satellite.operatorCountryId))
      .limit(limit);
    return rows.map((r) => ({ ...r, operatorCountryName: null }));
  }

  async findByNamePatternMismatch(
    pattern: string,
    limit = 1000,
  ): Promise<SuspectSatelliteRow[]> {
    return this.db
      .select({
        id: satellite.id,
        name: satellite.name,
        operatorCountryName: operatorCountry.name,
        operatorCountryId: satellite.operatorCountryId,
      })
      .from(satellite)
      .innerJoin(
        operatorCountry,
        eq(satellite.operatorCountryId, operatorCountry.id),
      )
      .where(
        and(
          sql`${satellite.name} ~* ${pattern}`,
          sql`${operatorCountry.name} !~* ${pattern}`,
        ),
      )
      .limit(limit);
  }

  async applyCorrections(
    corrections: Array<{
      satelliteId: bigint;
      newOperatorCountryId: bigint;
      entry: CorrectionEntry;
    }>,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      let n = 0;
      for (const c of corrections) {
        await tx
          .update(satellite)
          .set({
            operatorCountryId: c.newOperatorCountryId,
            profileMetadata: sql`jsonb_set(
            COALESCE(profile_metadata, '{}'::jsonb), '{corrections}',
            COALESCE(profile_metadata->'corrections', '[]'::jsonb) || ${JSON.stringify([c.entry])}::jsonb
          )`,
            updatedAt: new Date(),
          })
          .where(eq(satellite.id, c.satelliteId));
        n++;
      }
      logger.info({ count: n }, "OperatorCountry corrections applied");
      return n;
    });
  }

  // -- Doctrine payload validation ------------------------------------------

  async findSatellitesWithPayloadsByOperatorCountry(
    operatorCountryId: bigint,
    limit = 500,
  ): Promise<Array<{ id: bigint; name: string; payloads: string[] }>> {
    const rows = await this.db
      .select({
        id: satellite.id,
        name: satellite.name,
        payloadName: payload.name,
      })
      .from(satellite)
      .leftJoin(
        satellitePayload,
        eq(satellite.id, satellitePayload.satelliteId),
      )
      .leftJoin(payload, eq(satellitePayload.payloadId, payload.id))
      .where(eq(satellite.operatorCountryId, operatorCountryId))
      .limit(limit);

    const map = new Map<
      string,
      { id: bigint; name: string; payloads: string[] }
    >();
    for (const row of rows) {
      const key = row.id.toString();
      if (!map.has(key))
        map.set(key, { id: row.id, name: row.name, payloads: [] });
      if (row.payloadName) map.get(key)!.payloads.push(row.payloadName);
    }
    return Array.from(map.values());
  }

  // -- Sweep audit -----------------------------------------------------------

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
    // 1. Aggregate stats per operator-country
    const rows = await this.db.execute(sql`
      SELECT
        oc.id as operator_country_id,
        oc.name as operator_country_name,
        reg.name as orbit_regime_name,
        count(s.id)::int as satellite_count,
        count(s.id) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM satellite_payload sp WHERE sp.satellite_id = s.id
        ))::int as missing_payloads,
        count(s.id) FILTER (WHERE s.orbit_regime_id IS NULL)::int as missing_orbit_regime,
        count(s.id) FILTER (WHERE s.launch_year IS NULL)::int as missing_launch_year,
        count(s.id) FILTER (WHERE s.mass_kg = 0 OR s.mass_kg IS NULL)::int as missing_mass,
        (oc.doctrine IS NOT NULL) as has_doctrine,
        round(avg(s.mass_kg) FILTER (WHERE s.mass_kg > 0))::real as avg_mass
      FROM operator_country oc
      JOIN orbit_regime reg ON reg.id = oc.orbit_regime_id
      LEFT JOIN satellite s ON s.operator_country_id = oc.id
      GROUP BY oc.id, oc.name, reg.name, oc.doctrine
      HAVING count(s.id) > 0
      ORDER BY count(s.id) DESC
    `);

    const results = [];
    for (const row of rows.rows as Record<string, unknown>[]) {
      const ocId = row.operator_country_id as bigint;

      // 2. Top payloads for this operator-country
      const payloadsRes = await this.db.execute(sql`
        SELECT p.name FROM satellite_payload sp
        JOIN payload p ON p.id = sp.payload_id
        JOIN satellite s ON s.id = sp.satellite_id
        WHERE s.operator_country_id = ${ocId}
        GROUP BY p.name ORDER BY count(*) DESC LIMIT 5
      `);

      // 3. Sample satellites (top 3 by mass)
      const sampleRes = await this.db.execute(sql`
        SELECT name, mass_kg, launch_year
        FROM satellite WHERE operator_country_id = ${ocId} AND mass_kg > 0
        ORDER BY mass_kg DESC LIMIT 3
      `);

      results.push({
        operatorCountryId: ocId,
        operatorCountryName: row.operator_country_name as string,
        orbitRegimeName: row.orbit_regime_name as string,
        satelliteCount: row.satellite_count as number,
        missingPayloads: row.missing_payloads as number,
        missingOrbitRegime: row.missing_orbit_regime as number,
        missingLaunchYear: row.missing_launch_year as number,
        missingMass: row.missing_mass as number,
        hasDoctrine: row.has_doctrine as boolean,
        avgMass: row.avg_mass as number | null,
        topPayloads: (payloadsRes.rows as Array<{ name: string }>).map(
          (p) => p.name,
        ),
        sampleSatellites: (sampleRes.rows as Array<Record<string, unknown>>).map(
          (s) => ({
            name: s.name as string,
            massKg: s.mass_kg as number,
            launchYear: s.launch_year as number | null,
          }),
        ),
      });
    }

    return results;
  }

  // -- Admin backoffice -----------------------------------------------------

  async findAllPaginated(opts: {
    page: number;
    limit: number;
    search?: string;
    orbitRegime?: string;
    platformClass?: string;
    operatorCountry?: string;
    sort?: string;
  }): Promise<{
    satellites: Array<{
      id: bigint;
      name: string;
      slug: string;
      massKg: number;
      launchYear: number | null;
      isExperimental: boolean;
      rating: number | null;
      photoUrl: string | null;
      operatorCountryName: string | null;
      platformClassName: string | null;
      operatorName: string | null;
      orbitRegimeName: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    total: number;
  }> {
    const conds = [];
    if (opts.search) {
      // Split into words and require ALL to match (AND logic)
      const words = opts.search
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 1);
      for (const word of words) {
        const pattern = `%${escapeIlike(word)}%`;
        conds.push(
          sql`(
            unaccent(lower(${satellite.name})) ILIKE unaccent(lower(${pattern}))
            OR unaccent(lower(${operator.name})) ILIKE unaccent(lower(${pattern}))
            OR unaccent(lower(${operatorCountry.name})) ILIKE unaccent(lower(${pattern}))
          )`,
        );
      }
    }
    if (opts.orbitRegime)
      conds.push(sql`lower(${orbitRegime.name}) = lower(${opts.orbitRegime})`);
    if (opts.platformClass)
      conds.push(
        sql`lower(${platformClass.name}) = lower(${opts.platformClass})`,
      );
    if (opts.operatorCountry)
      conds.push(
        sql`unaccent(lower(${operatorCountry.name})) ILIKE unaccent(lower(${`%${escapeIlike(opts.operatorCountry)}%`}))`,
      );

    const where = conds.length > 0 ? and(...conds) : undefined;
    const offset = (opts.page - 1) * opts.limit;

    // Sort: explicit param > relevance (if searching) > newest
    let orderClauses: ReturnType<typeof sql>[];
    switch (opts.sort) {
      case "mass-asc":
        orderClauses = [sql`${satellite.massKg} ASC NULLS LAST`];
        break;
      case "mass-desc":
        orderClauses = [sql`${satellite.massKg} DESC NULLS LAST`];
        break;
      case "launchYear-desc":
        orderClauses = [sql`${satellite.launchYear} DESC NULLS LAST`];
        break;
      case "orbitRegime":
        orderClauses = [
          sql`${orbitRegime.name} ASC NULLS LAST`,
          sql`${operatorCountry.name} ASC NULLS LAST`,
        ];
        break;
      case "operatorCountry":
        orderClauses = [
          sql`${operatorCountry.name} ASC NULLS LAST`,
          sql`${orbitRegime.name} ASC NULLS LAST`,
        ];
        break;
      default:
        // "relevance" when searching, newest otherwise
        if (opts.search) {
          const fullTerm = `%${escapeIlike(opts.search)}%`;
          orderClauses = [
            // Exact full-term match in name ranks highest
            sql`CASE
              WHEN unaccent(lower(${satellite.name})) ILIKE unaccent(lower(${fullTerm})) THEN 1
              WHEN unaccent(lower(${operator.name})) ILIKE unaccent(lower(${fullTerm})) THEN 2
              WHEN unaccent(lower(${operatorCountry.name})) ILIKE unaccent(lower(${fullTerm})) THEN 3
              ELSE 4
            END`,
            sql`${satellite.rating} DESC NULLS LAST`,
          ];
        } else {
          orderClauses = [sql`${satellite.createdAt} DESC`];
        }
        break;
    }

    const [satellites, [{ total }]] = await Promise.all([
      this.applySatelliteJoins(this.db.select(satelliteListSelect).from(satellite))
        .where(where)
        .orderBy(...orderClauses)
        .limit(opts.limit)
        .offset(offset),
      this.applySatelliteJoins(
        this.db.select({ total: count() }).from(satellite),
      ).where(where),
    ]);
    return { satellites, total };
  }

  async findByIdWithDetails(id: bigint) {
    const [row] = await this.applySatelliteJoins(
      this.db.select(satelliteDetailSelect).from(satellite),
    )
      .where(eq(satellite.id, id))
      .limit(1);
    if (!row) return null;

    const payloadRows = await this.db
      .select({ name: payload.name })
      .from(satellitePayload)
      .innerJoin(payload, eq(satellitePayload.payloadId, payload.id))
      .where(eq(satellitePayload.satelliteId, id));

    return {
      ...row,
      telemetrySummary: extractTelemetry(row),
      payloads: payloadRows.map((p) => p.name),
    };
  }

  /**
   * Full satellite profile — everything needed for a rich satellite card.
   * Includes operator+ground-station, SatelliteBus template, operator-country doctrine, payload roles.
   */
  async findByIdFull(id: bigint) {
    // 1. Satellite + joins
    const [row] = await this.applySatelliteJoins(
      this.db
        .select({
          ...satelliteDetailSelect,
          variant: satellite.variant,
          isResilient: satellite.isResilient,
          classificationTier: satellite.classificationTier,
          kMultiplier: satellite.kMultiplier,
          descriptions: satellite.descriptions,
          gShortDescription: satellite.gShortDescription,
          gDescription: satellite.gDescription,
          gOperatorDescription: satellite.gOperatorDescription,
          gOperatorCountryDescription: satellite.gOperatorCountryDescription,
          gOrbitRegimeDescription: satellite.gOrbitRegimeDescription,
          gLaunchYearDescription: satellite.gLaunchYearDescription,
          satelliteBusId: satellite.satelliteBusId,
          operatorCountryId: satellite.operatorCountryId,
          operatorId: satellite.operatorId,
        })
        .from(satellite),
    )
      .where(eq(satellite.id, id))
      .limit(1);
    if (!row) return null;

    // 2. Parallel: payloads (with roles), operator+ground-station, SatelliteBus, doctrine
    const [payloadRows, operatorRow, busRow, doctrineData] = await Promise.all([
      this.db
        .select({
          name: payload.name,
          role: satellitePayload.role,
          massKg: satellitePayload.massKg,
          powerW: satellitePayload.powerW,
          technicalProfile: payload.technicalProfile,
          photoUrl: payload.photoUrl,
        })
        .from(satellitePayload)
        .innerJoin(payload, eq(satellitePayload.payloadId, payload.id))
        .where(eq(satellitePayload.satelliteId, id)),

      row.operatorId
        ? this.db
            .select({
              name: operator.name,
              latitude: operator.latitude,
              longitude: operator.longitude,
              groundStation: operator.groundStation,
            })
            .from(operator)
            .where(eq(operator.id, row.operatorId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),

      row.satelliteBusId
        ? this.db
            .select({
              id: satelliteBus.id,
              name: satelliteBus.name,
              ...telemetrySelect(satelliteBus),
            })
            .from(satelliteBus)
            .where(eq(satelliteBus.id, row.satelliteBusId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),

      row.operatorCountryId
        ? this.getOperatorCountryDoctrine(row.operatorCountryId)
        : Promise.resolve(null),
    ]);

    return {
      ...row,
      telemetrySummary: extractTelemetry(row),
      payloads: payloadRows.map((p) => ({
        name: p.name,
        role: p.role,
        massKg: p.massKg,
        powerW: p.powerW,
        technicalProfile: p.technicalProfile,
        photoUrl: p.photoUrl,
      })),
      operatorDetail: operatorRow,
      satelliteBus: busRow
        ? {
            id: String(busRow.id),
            name: busRow.name,
            telemetrySummary: extractTelemetry(busRow),
          }
        : null,
      doctrine: doctrineData,
    };
  }

  async update(
    id: bigint,
    data: Partial<
      TelemetryScalars & {
        name: string;
        massKg: number;
        launchYear: number;
        isExperimental: boolean;
        temperature: number;
        lifetime: number;
        power: number;
        rating: number;
        photoUrl: string | null;
      }
    >,
  ): Promise<boolean> {
    const result = await this.db
      .update(satellite)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(satellite.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async archive(id: bigint): Promise<boolean> {
    const result = await this.db
      .update(satellite)
      .set({
        profileMetadata: sql`jsonb_set(COALESCE(profile_metadata, '{}'::jsonb), '{archived}', 'true'::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(satellite.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // -- Null scan (Option 2: dynamic per-column pivot) ---------------------
  //
  // Enumerates every scalar nullable column on satellite (introspected from
  // information_schema at call time — new columns are picked up automatically
  // without code changes), then produces a single aggregated scan grouped by
  // operator_country.
  //
  // Excluded by policy (not by type):
  //   - primary key, created_at, updated_at
  //   - jsonb columns (requires structural audit, not null check)
  //   - slug / name (not-null by constraint anyway)
  //   - description fields (g_*_description, descriptions) — audited via
  //     a different path (editorial sweep)
  //
  // Returned rows are (operatorCountry × column) where null_count > 0 and
  // null_fraction >= minNullFraction. Rows with <totalCount threshold> are
  // dropped so tiny fleets don't dominate (e.g. a 1-sat fleet with 1 null
  // column would otherwise show 100% null_fraction).

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

  async nullScanByColumn(opts?: {
    maxOperatorCountries?: number;
    minNullFraction?: number;
    minTotal?: number;
    columns?: string[]; // restrict scan to these if provided
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

    // Defensive: re-validate column names against information_schema to avoid
    // any injection via `columns` param (even though the repo is
    // orchestration-internal).
    const discovered = new Set(await this.discoverNullableScalarColumns());
    const safeCols = allCols.filter((c) => discovered.has(c));
    if (safeCols.length === 0) return [];

    // Build per-column FILTER clauses — each count(*) FILTER (WHERE "col" IS NULL).
    // Column names are identifiers validated above, so injection is not possible.
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

    const res = await this.db.execute<Record<string, string | number | null>>(query);

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
        row.operator_country_id !== null && row.operator_country_id !== undefined
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
          column: safeCols[i],
          nullCount: nc,
          nullFraction: frac,
        });
      }
    }

    // Sort: highest fraction first, then biggest absolute count.
    out.sort((a, b) => {
      if (b.nullFraction !== a.nullFraction) return b.nullFraction - a.nullFraction;
      return b.nullCount - a.nullCount;
    });
    return out;
  }

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

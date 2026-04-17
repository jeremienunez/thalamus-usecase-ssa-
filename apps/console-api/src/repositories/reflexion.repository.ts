// apps/console-api/src/repositories/reflexion.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  ReflexionTarget,
  CoplaneRow,
  BeltRow,
  MilRow,
} from "../types/reflexion.types";
import type { OpacityCandidateRow } from "../types/opacity.types";

export type {
  ReflexionTarget,
  CoplaneRow,
  BeltRow,
  MilRow,
} from "../types/reflexion.types";

const SENSITIVE_OPERATOR_COUNTRIES = [
  "US Space Force",
  "USSF",
  "NRO",
  "National Reconnaissance Office",
  "GRU",
  "SSF",
  "Strategic Support Force",
  "MVR",
] as const;

export class ReflexionRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findTarget(norad: number): Promise<ReflexionTarget | null> {
    const rows = await this.db.execute<ReflexionTarget>(sql`
      SELECT
        s.id::text AS id,
        s.name,
        s.norad_id AS norad_id,
        s.object_class::text AS object_class,
        oc.name AS operator_country,
        s.classification_tier,
        pc.name AS platform_name,
        (s.telemetry_summary->>'inclination')::float AS inc,
        (s.telemetry_summary->>'raan')::float        AS raan,
        (s.telemetry_summary->>'meanMotion')::float  AS mm,
        (s.telemetry_summary->>'meanAnomaly')::float AS ma,
        (s.metadata->>'apogeeKm')::numeric::float    AS apogee,
        (s.metadata->>'perigeeKm')::numeric::float   AS perigee
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN platform_class pc   ON pc.id = s.platform_class_id
      WHERE s.norad_id = ${norad}
      LIMIT 1
    `);
    return rows.rows[0] ?? null;
  }

  async findStrictCoplane(
    norad: number,
    t: Pick<ReflexionTarget, "inc" | "raan" | "mm" | "ma">,
    dIncMax: number,
    dRaanMax: number,
    dMmMax: number,
  ): Promise<CoplaneRow[]> {
    const rows = await this.db.execute<CoplaneRow>(sql`
      SELECT
        s.id::text,
        s.norad_id::text,
        s.name,
        oc.name AS operator_country,
        s.classification_tier AS tier,
        s.object_class::text AS object_class,
        pc.name AS platform,
        abs((s.telemetry_summary->>'inclination')::float - ${t.inc})::float AS d_inc,
        abs((s.telemetry_summary->>'raan')::float        - ${t.raan})::float AS d_raan,
        ((((s.telemetry_summary->>'meanAnomaly')::float - ${t.ma ?? 0} + 720)::numeric % 360) / 360 * (1440.0/${t.mm}))::float AS lag_min
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN platform_class pc   ON pc.id = s.platform_class_id
      WHERE s.norad_id != ${norad}
        AND s.object_class = 'payload'
        AND abs((s.telemetry_summary->>'inclination')::float - ${t.inc}) < ${dIncMax}
        AND abs((s.telemetry_summary->>'raan')::float        - ${t.raan}) < ${dRaanMax}
        AND abs((s.telemetry_summary->>'meanMotion')::float  - ${t.mm})   < ${dMmMax}
      ORDER BY abs((s.telemetry_summary->>'inclination')::float - ${t.inc}) + abs((s.telemetry_summary->>'raan')::float - ${t.raan}) ASC
      LIMIT 30
    `);
    return rows.rows;
  }

  async findInclinationBelt(
    norad: number,
    inc: number,
    dIncMax: number,
  ): Promise<BeltRow[]> {
    const rows = await this.db.execute<BeltRow>(sql`
      SELECT
        oc.name AS country,
        s.classification_tier AS tier,
        s.object_class::text AS object_class,
        count(*)::text AS n
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      WHERE s.norad_id != ${norad}
        AND s.object_class = 'payload'
        AND abs((s.telemetry_summary->>'inclination')::float - ${inc}) < ${dIncMax}
      GROUP BY oc.name, s.classification_tier, s.object_class
      ORDER BY count(*) DESC
    `);
    return rows.rows;
  }

  async findMilLineagePeers(
    norad: number,
    inc: number,
    dIncMax: number,
  ): Promise<MilRow[]> {
    const rows = await this.db.execute<MilRow>(sql`
      SELECT
        s.id::text,
        s.norad_id::text,
        s.name,
        oc.name AS country,
        s.classification_tier AS tier,
        abs((s.telemetry_summary->>'inclination')::float - ${inc})::float AS d_inc
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      WHERE s.norad_id != ${norad}
        AND s.object_class = 'payload'
        AND abs((s.telemetry_summary->>'inclination')::float - ${inc}) < ${dIncMax}
        AND (
          s.name ILIKE 'YAOGAN%' OR s.name ILIKE 'USA %'   OR s.name ILIKE 'COSMOS%' OR
          s.name ILIKE 'SHIYAN%' OR s.name ILIKE 'NROL%'   OR s.name ILIKE 'LACROSSE%' OR
          s.name ILIKE 'TOPAZ%'  OR s.name ILIKE 'JANUS%'
        )
      ORDER BY d_inc ASC
      LIMIT 20
    `);
    return rows.rows;
  }

  // ── Cortex-consumed reads ──

  /** List satellites with opacity signal candidates. */ // ← absorbed from cortices/queries/opacity-scout.ts
  async listOpacityCandidates(
    opts: { limit?: number; minScoreFloor?: number } = {},
  ): Promise<OpacityCandidateRow[]> {
    const sensitive = sql.join(
      SENSITIVE_OPERATOR_COUNTRIES.map((s) => sql`${s.toLowerCase()}`),
      sql`, `,
    );
    const limit = opts.limit ?? 50;

    const result = await this.db.execute<OpacityCandidateRow>(sql`
      WITH amateur_agg AS (
        SELECT
          at.resolved_satellite_id             AS satellite_id,
          COUNT(*)                             AS obs_count,
          COUNT(DISTINCT at.source_id)         AS distinct_sources,
          MAX(at.observed_at)                  AS last_observed_at,
          COUNT(*) FILTER (
            WHERE s.slug = 'spacetrack-satcat-diff'
          )                                    AS dropout_count
        FROM amateur_track at
        LEFT JOIN source s ON s.id = at.source_id
        WHERE at.resolved_satellite_id IS NOT NULL
        GROUP BY at.resolved_satellite_id
      ),
      payload_agg AS (
        SELECT
          sp.satellite_id,
          bool_or(
            p.name IS NULL OR lower(p.name) LIKE '%undisclosed%'
              OR lower(p.name) LIKE '%classified%'
          ) AS payload_undisclosed
        FROM satellite_payload sp
        LEFT JOIN payload p ON p.id = sp.payload_id
        GROUP BY sp.satellite_id
      )
      SELECT
        s.id::int                                           AS "satelliteId",
        s.name,
        NULLIF(s.telemetry_summary->>'noradId', '')::int    AS "noradId",
        op.name                                             AS "operator",
        oc.name                                             AS "operatorCountry",
        pc.name                                             AS "platformClass",
        orr.name                                            AS "orbitRegime",
        s.launch_year                                       AS "launchYear",
        COALESCE(pa.payload_undisclosed, true)              AS "payloadUndisclosed",
        (lower(COALESCE(oc.name, '')) IN (${sensitive})) AS "operatorSensitive",
        COALESCE(aa.obs_count, 0)::int                      AS "amateurObservationsCount",
        COALESCE(aa.dropout_count, 0)::int                  AS "catalogDropoutCount",
        COALESCE(aa.distinct_sources, 0)::int               AS "distinctAmateurSources",
        aa.last_observed_at::text                           AS "lastAmateurObservedAt",
        s.opacity_score::float                              AS "opacityScore"
      FROM satellite s
      LEFT JOIN operator op          ON op.id  = s.operator_id
      LEFT JOIN operator_country oc  ON oc.id  = s.operator_country_id
      LEFT JOIN platform_class pc    ON pc.id  = s.platform_class_id
      LEFT JOIN orbit_regime orr     ON orr.id = oc.orbit_regime_id
      LEFT JOIN amateur_agg aa       ON aa.satellite_id = s.id
      LEFT JOIN payload_agg pa       ON pa.satellite_id = s.id
      WHERE
        COALESCE(pa.payload_undisclosed, true) = true
        OR lower(COALESCE(oc.name, '')) IN (${sensitive})
        OR aa.obs_count > 0
      ORDER BY
        (CASE WHEN aa.obs_count > 0 THEN 1 ELSE 0 END
          + CASE WHEN aa.dropout_count > 0 THEN 1 ELSE 0 END
          + CASE WHEN lower(COALESCE(oc.name, '')) IN (${sensitive}) THEN 1 ELSE 0 END
          + CASE WHEN COALESCE(pa.payload_undisclosed, true) THEN 1 ELSE 0 END
        ) DESC,
        aa.obs_count DESC NULLS LAST
      LIMIT ${limit}
    `);

    return result.rows;
  }

  /** Persist computed opacity score back to satellite. */ // ← absorbed from cortices/queries/opacity-scout.ts
  async writeOpacityScore(
    satelliteId: number,
    score: number,
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE satellite
      SET
        opacity_score = ${score}::numeric(4, 3),
        opacity_computed_at = now()
      WHERE id = ${satelliteId}
    `);
  }
}

// apps/console-api/src/repositories/reflexion.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type ReflexionTarget = {
  id: string;
  name: string;
  object_class: string | null;
  operator_country: string | null;
  classification_tier: string | null;
  platform_name: string | null;
  inc: number | null;
  raan: number | null;
  mm: number | null;
  ma: number | null;
  apogee: number | null;
  perigee: number | null;
};

export type CoplaneRow = {
  id: string;
  norad_id: string;
  name: string;
  operator_country: string | null;
  tier: string | null;
  object_class: string | null;
  platform: string | null;
  d_inc: number;
  d_raan: number;
  lag_min: number;
};

export type BeltRow = {
  country: string | null;
  tier: string | null;
  object_class: string | null;
  n: string;
};

export type MilRow = {
  id: string;
  norad_id: string;
  name: string;
  country: string | null;
  tier: string | null;
  d_inc: number;
};

export class ReflexionRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findTarget(norad: number): Promise<ReflexionTarget | null> {
    const rows = await this.db.execute<ReflexionTarget>(sql`
      SELECT
        s.id::text AS id,
        s.name,
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
}

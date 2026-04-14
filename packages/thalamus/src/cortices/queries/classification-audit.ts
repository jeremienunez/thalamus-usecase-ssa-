/**
 * SQL helpers — Classification Audit.
 *
 * Flags satellites with suspicious classification / mass / regime / temporal
 * combinations. Uses ONLY live columns on `satellite`, `platform_class`,
 * and `operator`.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

export interface ClassificationAuditRow {
  satelliteId: string;
  satelliteName: string;
  operatorName: string | null;
  platformClass: string | null;
  classificationTier: string | null;
  launchYear: number | null;
  massKg: number | null;
  flag: string;
  details: string;
}

export async function querySatelliteClassificationAudit(
  db: Database,
  opts: { limit?: number } = {},
): Promise<ClassificationAuditRow[]> {
  const limit = opts.limit ?? 50;

  const results = await db.execute(sql`
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

  return (results.rows as unknown as ClassificationAuditRow[]).map((r) => ({
    ...r,
    satelliteId: String(r.satelliteId),
  }));
}

export const queryClassificationAudit = querySatelliteClassificationAudit;

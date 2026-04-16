/**
 * OpacityScout queries — fuse official catalog + amateur_track observations
 * into per-satellite "information deficit" rows.
 *
 * The cortex scores each satellite on a [0..1] opacity scale from signals:
 *   - `payload_undisclosed`        — payload table null or name contains "undisclosed"
 *   - `operator_sensitive`         — operator country in (USSF, NRO, GRU, SSF…)
 *   - `has_amateur_observations`   — ≥ 1 amateur_track resolved to this satellite
 *   - `catalog_dropout`            — amateur_track row from the spacetrack-diff
 *                                    source_id — satellite vanished then reappeared
 *   - `amateur_disagrees`          — amateur track's orbit regime contradicts catalog
 *
 * Downstream (executor → LLM) turns the signal bundle into a finding with
 * cortex=OpacityScout, source_class=OSINT_AMATEUR → OSINT_CORROBORATED when
 * ≥ 2 independent amateur sources agree (reuses the existing promotion path).
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

export interface OpacitySignalRow {
  satelliteId: number;
  name: string;
  noradId: number | null;
  operator: string | null;
  operatorCountry: string | null;
  platformClass: string | null;
  orbitRegime: string | null;
  launchYear: number | null;
  // Derived signals
  payloadUndisclosed: boolean;
  operatorSensitive: boolean;
  amateurObservationsCount: number;
  catalogDropoutCount: number;
  distinctAmateurSources: number;
  lastAmateurObservedAt: string | null;
  // Cached score (null until the cortex writes it back)
  opacityScore: number | null;
}

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

/**
 * Return every satellite with ≥ 1 candidate opacity signal, joined with its
 * reference vocabulary and aggregated amateur-tracker stats.
 *
 * `candidate` here means the satellite triggered at least one hard signal
 * (undisclosed payload, sensitive operator country, amateur observation).
 * The LLM pre-summarizer branch in [cortices/executor.ts] turns the row
 * bundle into finding text; scoring is done at executor time by combining
 * the boolean signals with the amateur-source count.
 */
export async function listOpacityCandidates(
  db: Database,
  opts: { limit?: number; minScoreFloor?: number } = {},
): Promise<OpacitySignalRow[]> {
  const sensitive = sql.join(
    SENSITIVE_OPERATOR_COUNTRIES.map((s) => sql`${s.toLowerCase()}`),
    sql`, `,
  );
  const limit = opts.limit ?? 50;

  const result = await db.execute(sql`
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

  return result.rows as unknown as OpacitySignalRow[];
}

/**
 * Persist the computed opacity score back to `satellite.opacity_score`.
 * Called by the cortex after it summarises signals into a finding.
 */
export async function writeOpacityScore(
  db: Database,
  satelliteId: number,
  score: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE satellite
    SET
      opacity_score = ${score}::numeric(4, 3),
      opacity_computed_at = now()
    WHERE id = ${satelliteId}
  `);
}

/**
 * Pure — compute an opacity score from signal flags. Exported so the cortex
 * executor uses one deterministic scorer across pre-summariser and writeback.
 *
 * Weights:
 *   0.25 payload undisclosed
 *   0.25 sensitive operator country
 *   0.20 has amateur observations
 *   0.20 catalog dropout present
 *   0.10 multiple distinct amateur sources agree (corroboration bonus)
 */
export function computeOpacityScore(signals: {
  payloadUndisclosed: boolean;
  operatorSensitive: boolean;
  amateurObservationsCount: number;
  catalogDropoutCount: number;
  distinctAmateurSources: number;
}): number {
  let score = 0;
  if (signals.payloadUndisclosed) score += 0.25;
  if (signals.operatorSensitive) score += 0.25;
  if (signals.amateurObservationsCount > 0) score += 0.2;
  if (signals.catalogDropoutCount > 0) score += 0.2;
  if (signals.distinctAmateurSources >= 2) score += 0.1;
  return Math.min(1, Math.max(0, score));
}

/**
 * SQL helpers — Payload Profiler context.
 *
 * Fetches payload identity, satellite distribution (where the payload
 * flies), operator-country allocation data, and prior research findings.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

export interface PayloadContextRow {
  type: string;
  [key: string]: unknown;
}

export async function queryPayloadContext(
  db: Database,
  opts: {
    payloadId?: number | bigint;
    payloadName?: string;
    payloadKind?: string; // alias — planner may use this
    batch?: boolean;
    limit?: number;
    [key: string]: unknown; // accept any planner params gracefully
  },
): Promise<PayloadContextRow[]> {
  const limit = opts.limit ?? 10;

  // Batch mode: return priority list of payloads needing profiles
  if (opts.batch) {
    const result = await db.execute(sql`
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
    return result.rows as PayloadContextRow[];
  }

  // Single payload mode — accept any naming convention the planner might use
  const rawName =
    (opts.payloadName as string) ??
    (opts.payloadKind as string) ??
    (opts.payload_name as string) ??
    (opts.payload_kind as string) ??
    (opts.payload as string) ??
    (opts.name as string) ??
    "";
  // Strip any trailing band / spectrum hint (e.g. "AMSR-2 K", "Ka-band SAR")
  const searchName = rawName.replace(/\s+[A-Z]{1,3}$/, "").trim();
  const payloadFilter = opts.payloadId
    ? sql`p.id = ${opts.payloadId}`
    : sql`similarity(lower(p.name), lower(${searchName})) > 0.15`;

  const results: PayloadContextRow[] = [];

  // 1. Payload identity + existing profile
  const identityResult = await db.execute(sql`
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
  const identity = identityResult.rows[0] as PayloadContextRow | undefined;
  if (identity) results.push(identity);

  const payloadId = identity?.payloadId;
  if (!payloadId) return results;

  // 2. Satellite distribution — which missions carry this payload
  const satelliteStats = await db.execute(sql`
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
  results.push(...(satelliteStats.rows as PayloadContextRow[]));

  // 3. Payload role / mass / power allocation per operator country (doctrine-derived)
  const allocationData = await db.execute(sql`
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
  results.push(...(allocationData.rows as PayloadContextRow[]));

  // 4. Existing research findings about this payload
  const findings = await db.execute(sql`
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
  results.push(...(findings.rows as PayloadContextRow[]));

  return results;
}

/** Alias for the skill-declared helper name (see skills/payload-profiler.md frontmatter). */
export const queryPayloadProfile = queryPayloadContext;

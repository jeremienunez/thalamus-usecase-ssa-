/**
 * SatelliteFleetRepository — narrow repo for fleet aggregates consumed by sim.
 *
 * Plan 2 · B.1: introduced so SsaFleetProvider doesn't have to depend on the
 * 575-line kitchen-sink SatelliteRepository. Follow-up in TODO.md splits the
 * monolith into per-responsibility repos; this file is the first of those.
 *
 * Single responsibility: aggregate operator-level fleet snapshots.
 */

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export interface OperatorFleetSnapshot {
  operatorName: string;
  operatorCountry: string | null;
  satelliteCount: number;
  regimeMix: Array<{ regime: string; count: number }>;
  platformMix: Array<{ platform: string; count: number }>;
  avgLaunchYear: number | null;
}

export class SatelliteFleetRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * One aggregate query: operator + country + satellite count + avg launch
   * year + top-5 regime mix + top-5 platform mix. Consumed by SimFleetProvider
   * (apps/console-api/src/agent/ssa/sim/fleet-provider.ts).
   *
   * Throws if the operator row is missing.
   */
  async getOperatorFleetSnapshot(operatorId: number): Promise<OperatorFleetSnapshot> {
    const result = await this.db.execute(sql`
      WITH fleet AS (
        SELECT
          s.id,
          s.launch_year,
          orr.name AS regime_name,
          pc.name AS platform_name
        FROM satellite s
        LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
        LEFT JOIN orbit_regime orr    ON orr.id = oc.orbit_regime_id
        LEFT JOIN platform_class pc   ON pc.id = s.platform_class_id
        WHERE s.operator_id = ${BigInt(operatorId)}
      )
      SELECT
        op.name AS operator_name,
        oc.name AS country_name,
        (SELECT count(*)::int FROM fleet) AS satellite_count,
        (SELECT avg(launch_year)::int FROM fleet WHERE launch_year IS NOT NULL) AS avg_launch_year,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object('regime', regime_name, 'count', c))
           FROM (SELECT regime_name, count(*)::int AS c FROM fleet
                 WHERE regime_name IS NOT NULL
                 GROUP BY regime_name ORDER BY c DESC LIMIT 5) r),
          '[]'::jsonb
        ) AS regime_mix,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object('platform', platform_name, 'count', c))
           FROM (SELECT platform_name, count(*)::int AS c FROM fleet
                 WHERE platform_name IS NOT NULL
                 GROUP BY platform_name ORDER BY c DESC LIMIT 5) p),
          '[]'::jsonb
        ) AS platform_mix
      FROM operator op
      LEFT JOIN satellite s2          ON s2.operator_id = op.id
      LEFT JOIN operator_country oc   ON oc.id = s2.operator_country_id
      WHERE op.id = ${BigInt(operatorId)}
      GROUP BY op.name, oc.name
      LIMIT 1
    `);

    const row = result.rows[0] as
      | {
          operator_name: string;
          country_name: string | null;
          satellite_count: number | null;
          avg_launch_year: number | null;
          regime_mix: Array<{ regime: string; count: number }> | null;
          platform_mix: Array<{ platform: string; count: number }> | null;
        }
      | undefined;

    if (!row) {
      throw new Error(`SatelliteFleetRepository: operator ${operatorId} not found`);
    }

    return {
      operatorName: row.operator_name,
      operatorCountry: row.country_name,
      satelliteCount: row.satellite_count ?? 0,
      regimeMix: row.regime_mix ?? [],
      platformMix: row.platform_mix ?? [],
      avgLaunchYear: row.avg_launch_year,
    };
  }

  /**
   * Author-label lookup for sim observable logs. Returns a Map keyed by
   * sim_agent.id → operator.name (fallback `agent#<agentIndex>` if the
   * operator join is null). Consumed by MemoryService via SimFleetProvider.
   */
  async getSimAgentAuthorLabels(agentIds: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (agentIds.length === 0) return out;
    const unique = Array.from(new Set(agentIds));
    const rows = await this.db.execute(sql`
      SELECT a.id::text AS id, coalesce(op.name, 'agent#' || a.agent_index) AS label
      FROM sim_agent a
      LEFT JOIN operator op ON op.id = a.operator_id
      WHERE a.id = ANY(${sql.raw(`ARRAY[${unique.map((i) => `${i}::bigint`).join(",")}]`)})
    `);
    for (const r of rows.rows as Array<{ id: string; label: string }>) {
      out.set(Number(r.id), r.label);
    }
    return out;
  }
}

/**
 * LegacySsaFleetProvider — fallback SimFleetProvider implementation.
 *
 * Implements the port inside the sweep package using raw SQL. Used ONLY when
 * buildSweepContainer is called WITHOUT opts.sim.fleet (legacy callers, sweep-
 * side self-contained tests). The console-api path injects SsaFleetProvider
 * (apps/console-api/src/agent/ssa/sim/fleet-provider.ts) which reads via the
 * narrow SatelliteFleetRepository.
 *
 * Plan 2 lifecycle:
 *   - B.1: this file lands, added to PLAN2_DEFERRED_ALLOWLIST.
 *   - Étape 4 (post-B.11): delete this file; container always requires the port.
 *
 * SQL bodies lifted verbatim from agent-builder.ts (loadFleetSnapshot) and
 * memory.service.ts (lookupAuthorLabels).
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";
import type {
  SimFleetProvider,
  AgentSubjectRef,
  AgentSubjectSnapshot,
} from "./ports";

export class LegacySsaFleetProvider implements SimFleetProvider {
  constructor(private readonly db: Database) {}

  async getAgentSubject(ref: AgentSubjectRef): Promise<AgentSubjectSnapshot> {
    if (ref.kind !== "operator") {
      throw new Error(
        `LegacySsaFleetProvider: only supports kind="operator", got "${ref.kind}"`,
      );
    }
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
        WHERE s.operator_id = ${BigInt(ref.id)}
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
      WHERE op.id = ${BigInt(ref.id)}
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

    if (!row) throw new Error(`Operator ${ref.id} not found`);

    return {
      displayName: row.operator_name,
      attributes: {
        operatorCountry: row.country_name,
        satelliteCount: row.satellite_count ?? 0,
        regimeMix: row.regime_mix ?? [],
        platformMix: row.platform_mix ?? [],
        avgLaunchYear: row.avg_launch_year,
      },
    };
  }

  async getAuthorLabels(agentIds: number[]): Promise<Map<number, string>> {
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

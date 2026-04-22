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
import type { OperatorFleetSnapshot } from "../types/sim-fleet.types";
import {
  operatorFleetRollupSql,
  type OperatorFleetRollupRow,
} from "./queries/operator-fleet-rollup";

export class SatelliteFleetRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Single-operator fleet snapshot for the sim flow. Backed by the shared
   * operatorFleetRollupSql builder — same SQL as the HTTP /api/fleet route,
   * just scoped to one operator. Drops busMix (not consumed by sim).
   *
   * Throws if the operator row is missing.
   */
  async getOperatorFleetSnapshot(
    operatorId: number,
  ): Promise<OperatorFleetSnapshot> {
    const result = await this.db.execute<OperatorFleetRollupRow>(
      operatorFleetRollupSql({ operatorId: BigInt(operatorId), limit: 1 }),
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `SatelliteFleetRepository: operator ${operatorId} not found`,
      );
    }
    return {
      operatorName: row.operatorName,
      operatorCountry: row.country,
      satelliteCount: row.satelliteCount,
      regimeMix: row.regimeMix,
      platformMix: row.platformMix,
      avgLaunchYear: row.avgLaunchYear,
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

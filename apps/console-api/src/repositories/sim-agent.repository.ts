/**
 * SimAgentRepository — narrow SQL over the `sim_agent` table.
 *
 * Consumers:
 *   - `services/sim-launch.service.ts` → insert one sim_agent per operator
 *     when a fish is created (via buildOperatorAgent equivalent on the app side)
 *   - turn runners → listByRun for per-turn context assembly (over HTTP in
 *     Phase 3; today the kernel still reads directly, covered by the
 *     arch-guard in Phase 4)
 *   - `controllers/sim.controller.ts` → agent-count endpoint
 *
 * `getSimAgentAuthorLabels` (operator join) stays on
 * `satellite-fleet.repository.ts` — it already exists there; no duplication.
 *
 * Introduced: Plan 5 Task 1.A.4.
 */

import { asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { NewSimAgent } from "@interview/db-schema";
import { simAgent } from "@interview/db-schema";
import type { InsertSimAgentInput, SimAgentRow } from "../types/sim-agent.types";

export type { InsertSimAgentInput, SimAgentRow };

export class SimAgentRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /** Insert a sim_agent row. Returns the generated bigint id. */
  async insert(input: InsertSimAgentInput): Promise<bigint> {
    const row: NewSimAgent = {
      simRunId: input.simRunId,
      operatorId: input.operatorId,
      agentIndex: input.agentIndex,
      persona: input.persona,
      goals: input.goals,
      constraints: input.constraints,
    };
    const [inserted] = await this.db
      .insert(simAgent)
      .values(row)
      .returning({ id: simAgent.id });
    if (!inserted) throw new Error("insert sim_agent returned no row");
    return inserted.id;
  }

  /** All agents for a run, ordered by agent_index ascending. */
  async listByRun(simRunId: bigint): Promise<SimAgentRow[]> {
    const rows = await this.db
      .select()
      .from(simAgent)
      .where(eq(simAgent.simRunId, simRunId))
      .orderBy(asc(simAgent.agentIndex));
    return rows.map((r) => ({
      id: r.id,
      simRunId: r.simRunId,
      operatorId: r.operatorId,
      agentIndex: r.agentIndex,
      persona: r.persona,
      goals: r.goals,
      constraints: r.constraints,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Count agents in a run. Feeds the `/agent-count` route + the
   * orchestrator's schedule-next math (turnsPlayed / agentCount).
   */
  async countForRun(simRunId: bigint): Promise<number> {
    const rows = await this.db.execute<{ c: number }>(sql`
      SELECT count(*)::int AS c FROM sim_agent WHERE sim_run_id = ${simRunId}
    `);
    return rows.rows[0]?.c ?? 0;
  }
}

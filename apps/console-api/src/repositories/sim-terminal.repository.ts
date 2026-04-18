/**
 * SimTerminalRepository — cross-table reads for "terminal agent turns of
 * a swarm" (the last agent turn of each fish in a sim_swarm).
 *
 * This repo owns two queries only:
 *   - full terminals (sim_run + terminal sim_turn + sim_agent + turn
 *     count) for the narrative aggregator's clustering input;
 *   - slim terminal actions (sim_run + terminal sim_turn action JSONB)
 *     for the scalar (telemetry) aggregator's stats input.
 *
 * Both queries use `SELECT DISTINCT ON` to pick the latest agent turn per
 * fish. Runs with zero agent turns (quorum-fail cases) still appear with
 * `action = null` — callers filter on that.
 *
 * Consumers (server-side only):
 *   - `services/sim-pc-aggregator.service.ts`
 *   - `services/sim-telemetry-aggregator.service.ts`
 *   - `controllers/sim.controller.ts` → §5.5 routes
 *
 * Introduced: Plan 5 Task 1.A.6.
 */

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { SimRunStatus, TurnAction } from "@interview/db-schema";
import type {
  SimFishTerminalActionRow,
  SimFishTerminalRow,
} from "../types/sim-terminal.types";

export type { SimFishTerminalActionRow, SimFishTerminalRow };

export class SimTerminalRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * One row per sim_run in the swarm, carrying:
   *   - sim_run.id, fish_index, status
   *   - the terminal (highest turn_index) sim_turn.action + observable_summary
   *   - the authoring sim_agent.agent_index
   *   - the total count of agent turns in the run
   *
   * Runs without any agent turn still appear (action=null, observableSummary=null,
   * turnsPlayed=0). Callers filter.
   */
  async listTerminalsForSwarm(swarmId: bigint): Promise<SimFishTerminalRow[]> {
    const rows = await this.db.execute<{
      sim_run_id: string;
      fish_index: number;
      run_status: SimRunStatus;
      agent_id: string | null;
      agent_index: number | null;
      action: TurnAction | null;
      observable_summary: string | null;
      turns_played: number;
    }>(sql`
      WITH latest AS (
        SELECT DISTINCT ON (r.id)
          r.id::text         AS sim_run_id,
          r.fish_index       AS fish_index,
          r.status           AS run_status,
          t.agent_id::text   AS agent_id,
          t.action           AS action,
          t.observable_summary AS observable_summary
        FROM sim_run r
        LEFT JOIN sim_turn t
          ON t.sim_run_id = r.id AND t.actor_kind = 'agent'
        WHERE r.swarm_id = ${swarmId}
        ORDER BY r.id, t.turn_index DESC NULLS LAST
      )
      SELECT l.*,
             a.agent_index AS agent_index,
             (SELECT count(*)::int FROM sim_turn t2
              WHERE t2.sim_run_id = l.sim_run_id::bigint
                AND t2.actor_kind = 'agent') AS turns_played
      FROM latest l
      LEFT JOIN sim_agent a ON a.id::text = l.agent_id
    `);

    return rows.rows.map((r) => ({
      simRunId: BigInt(r.sim_run_id),
      fishIndex: r.fish_index,
      runStatus: r.run_status,
      agentIndex: r.agent_index,
      action: r.action,
      observableSummary: r.observable_summary,
      turnsPlayed: r.turns_played ?? 0,
    }));
  }

  /**
   * Slim variant — one row per sim_run with the terminal action JSONB +
   * run status only. Feeds the scalar (telemetry) aggregator which
   * computes median / σ / min / max from the action payload.
   */
  async listTerminalActionsForSwarm(
    swarmId: bigint,
  ): Promise<SimFishTerminalActionRow[]> {
    const rows = await this.db.execute<{
      sim_run_id: string;
      run_status: SimRunStatus;
      action: TurnAction | null;
    }>(sql`
      WITH latest AS (
        SELECT DISTINCT ON (r.id)
          r.id::text  AS sim_run_id,
          r.status    AS run_status,
          t.action    AS action
        FROM sim_run r
        LEFT JOIN sim_turn t
          ON t.sim_run_id = r.id AND t.actor_kind = 'agent'
        WHERE r.swarm_id = ${swarmId}
        ORDER BY r.id, t.turn_index DESC NULLS LAST
      )
      SELECT * FROM latest
    `);
    return rows.rows.map((r) => ({
      simRunId: BigInt(r.sim_run_id),
      runStatus: r.run_status,
      action: r.action,
    }));
  }
}

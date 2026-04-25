/**
 * SimRunRepository — narrow SQL over the `sim_run` table.
 *
 * Consumers:
 *   - `services/sim-launch.service.ts` → insert one sim_run per fish
 *   - `services/sim-orchestrator.service.ts` → status transitions for standalone flow
 *   - `controllers/sim.controller.ts` → §5.1 routes
 *   - `services/sim-worker-hooks.service.ts` → abort cascade (fail pending/running)
 *
 * SRP: every method touches sim_run only. Counts over sim_agent / sim_turn
 * (even when they're "per swarm" or "per run") live on sim-agent.repository.ts
 * and sim-turn.repository.ts respectively — the table owns the count.
 *
 * Cross-table fish-count aggregation (GROUP BY status) lives here because
 * it reads only sim_run.
 *
 * Introduced: Plan 5 Task 1.A.2.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  NewSimRun,
  SeedRefs,
  SimRunStatus,
} from "@interview/db-schema";
import { simRun } from "@interview/db-schema";
import type {
  InsertSimRunInput,
  SimRunRow,
  SimSwarmFishCounts,
} from "../types/sim-run.types";

export type { InsertSimRunInput, SimRunRow, SimSwarmFishCounts };

export class SimRunRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /** Insert a sim_run row. Returns the generated bigint id. */
  async insert(input: InsertSimRunInput): Promise<bigint> {
    const row: NewSimRun = {
      swarmId: input.swarmId,
      fishIndex: input.fishIndex,
      kind: input.kind,
      seedApplied: input.seedApplied,
      perturbation: input.perturbation,
      config: input.config,
      status: input.status ?? "pending",
    };
    const [inserted] = await this.db
      .insert(simRun)
      .values(row)
      .returning({ id: simRun.id });
    if (!inserted) throw new Error("insert sim_run returned no row");
    return inserted.id;
  }

  /** Full row by id; null if missing. */
  async findById(simRunId: bigint): Promise<SimRunRow | null> {
    const rows = await this.db
      .select()
      .from(simRun)
      .where(eq(simRun.id, simRunId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      swarmId: r.swarmId,
      fishIndex: r.fishIndex,
      kind: r.kind,
      seedApplied: r.seedApplied,
      perturbation: r.perturbation,
      config: r.config,
      status: r.status,
      reportFindingId: r.reportFindingId,
      llmCostUsd: r.llmCostUsd,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    };
  }

  /**
   * Transition to a new status. Callers are expected to validate the
   * current → next transition is legal at service level; this repo does
   * not enforce state-machine rules.
   *
   * Pass `completedAt` when moving to a terminal state (done/failed);
   * omit for running/paused.
   */
  async updateStatus(
    simRunId: bigint,
    status: SimRunStatus,
    completedAt?: Date | null,
  ): Promise<void> {
    const patch: { status: SimRunStatus; completedAt?: Date | null } = { status };
    if (completedAt !== undefined) {
      patch.completedAt = completedAt;
    }
    await this.db.update(simRun).set(patch).where(eq(simRun.id, simRunId));
  }

  /**
   * Extract the `seed_applied` JSONB payload for a run. Used by the
   * `GET /api/sim/runs/:id/seed` route and by server-side target
   * resolution (sim-target.service.ts consuming pcEstimatorTarget /
   * telemetryTargetSatelliteId).
   */
  async getSeedApplied(simRunId: bigint): Promise<SeedRefs | null> {
    const rows = await this.db
      .select({ seedApplied: simRun.seedApplied })
      .from(simRun)
      .where(eq(simRun.id, simRunId))
      .limit(1);
    return rows[0]?.seedApplied ?? null;
  }

  /**
   * Count fish of a swarm grouped by their sim_run status. All five
   * statuses are always present in the returned object; missing groups
   * default to 0.
   *
   * Feeds §5.2 `GET /api/sim/swarms/:id/fish-counts` and the status
   * endpoint that assembles swarm-level summaries.
   */
  async countFishByStatus(swarmId: bigint): Promise<SimSwarmFishCounts> {
    const rows = await this.db.execute<{ status: SimRunStatus; c: number }>(sql`
      SELECT status, count(*)::int AS c
      FROM sim_run
      WHERE swarm_id = ${swarmId}
      GROUP BY status
    `);
    const out: SimSwarmFishCounts = {
      done: 0,
      failed: 0,
      timeout: 0,
      running: 0,
      pending: 0,
      paused: 0,
    };
    for (const r of rows.rows) {
      if (r.status in out) {
        out[r.status as keyof SimSwarmFishCounts] = r.c;
      }
    }
    return out;
  }

  /**
   * Cascade failure: mark every sim_run in the swarm whose status is still
   * pending or running as failed. Called by the abort service as part of
   * the swarm-level abort flow; caller is responsible for marking the
   * sim_swarm itself failed in the same transaction.
   */
  async failPendingAndRunningForSwarm(swarmId: bigint): Promise<void> {
    await this.db
      .update(simRun)
      .set({ status: "failed", completedAt: new Date() })
      .where(
        and(
          eq(simRun.swarmId, swarmId),
          inArray(simRun.status, ["pending", "running"] as SimRunStatus[]),
        ),
      );
  }
}

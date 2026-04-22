/**
 * SimSwarmRepository — narrow SQL over the `sim_swarm` table.
 *
 * Consumers:
 *   - `services/sim-launch.service.ts` → insert on swarm launch
 *   - `controllers/sim.controller.ts` → findById + state transitions wired
 *     to routes under §5.2 of docs/superpowers/plans/2026-04-18-plan5-sim-http-contract.md
 *   - `services/sim-promotion.service.ts` → linkOutcome after aggregator promotes
 *
 * SRP: this repo owns sim_swarm writes plus the one atomic abort cascade
 * that must fail the swarm and its still-open sim_run rows together.
 *
 * Introduced: Plan 5 Task 1.A.1.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  NewSimSwarm,
  SimRunStatus,
} from "@interview/db-schema";
import { simRun, simSwarm } from "@interview/db-schema";
import type {
  CloseSimSwarmInput,
  InsertSimSwarmInput,
  LinkOutcomeInput,
  SnapshotAggregateInput,
  SimSwarmRow,
} from "../types/sim-swarm.types";

export type {
  CloseSimSwarmInput,
  InsertSimSwarmInput,
  LinkOutcomeInput,
  SnapshotAggregateInput,
  SimSwarmRow,
};

function aggregatePathLiteral(
  key: string,
): string {
  if (!/^[A-Za-z0-9_]+$/.test(key)) {
    throw new Error(`invalid aggregate path key: ${key}`);
  }
  return `'{${key}}'::text[]`;
}

export class SimSwarmRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Insert a sim_swarm row. `status` defaults to the schema default
   * ("pending") when omitted; `startedAt` defaults to `now()`.
   * Returns the generated bigint id.
   */
  async insert(input: InsertSimSwarmInput): Promise<bigint> {
    const row: NewSimSwarm = {
      kind: input.kind,
      title: input.title,
      baseSeed: input.baseSeed,
      perturbations: input.perturbations,
      size: input.size,
      config: input.config,
      status: input.status ?? "pending",
      createdBy: input.createdBy ?? null,
    };
    const [inserted] = await this.db
      .insert(simSwarm)
      .values(row)
      .returning({ id: simSwarm.id });
    if (!inserted) throw new Error("insert sim_swarm returned no row");
    return inserted.id;
  }

  /** Full sim_swarm row by id; null when not found. */
  async findById(swarmId: bigint): Promise<SimSwarmRow | null> {
    const rows = await this.db
      .select()
      .from(simSwarm)
      .where(eq(simSwarm.id, swarmId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      baseSeed: r.baseSeed,
      perturbations: r.perturbations,
      size: r.size,
      config: r.config,
      status: r.status,
      outcomeReportFindingId: r.outcomeReportFindingId,
      suggestionId: r.suggestionId,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      createdBy: r.createdBy,
    };
  }

  /** Transition to status='done' and stamp completed_at. */
  async markDone(swarmId: bigint): Promise<void> {
    await this.closeSwarm({
      swarmId,
      status: "done",
    });
  }

  /** Transition to status='failed' and stamp completed_at. */
  async markFailed(swarmId: bigint): Promise<void> {
    await this.closeSwarm({
      swarmId,
      status: "failed",
    });
  }

  /**
   * Attach a research_finding id and/or a sweep_suggestion id to the swarm
   * row after promotion. Either or both may be provided; unspecified fields
   * are left unchanged. No-op when both refs are undefined.
   */
  async linkOutcome(swarmId: bigint, refs: LinkOutcomeInput): Promise<void> {
    const patch: { outcomeReportFindingId?: bigint | null; suggestionId?: bigint | null } = {};
    if (refs.reportFindingId !== undefined) {
      patch.outcomeReportFindingId = refs.reportFindingId;
    }
    if (refs.suggestionId !== undefined) {
      patch.suggestionId = refs.suggestionId;
    }
    if (Object.keys(patch).length === 0) return;
    await this.db.update(simSwarm).set(patch).where(eq(simSwarm.id, swarmId));
  }

  /**
   * Abort the swarm atomically: fail the sim_swarm row and any still-open
   * fish (`pending` / `running`) in sim_run with one shared timestamp.
   */
  async abortSwarm(swarmId: bigint): Promise<void> {
    const completedAt = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(simSwarm)
        .set({ status: "failed", completedAt })
        .where(eq(simSwarm.id, swarmId));
      await tx
        .update(simRun)
        .set({ status: "failed", completedAt })
        .where(
          and(
            eq(simRun.swarmId, swarmId),
            inArray(simRun.status, ["pending", "running"] as SimRunStatus[]),
          ),
        );
    });
  }

  /**
   * Persist aggregator output under a stable top-level key inside
   * sim_swarm.config using jsonb_set.
   */
  async snapshotAggregate(input: SnapshotAggregateInput): Promise<void> {
    await this.db.execute(sql`
      UPDATE sim_swarm
      SET config = jsonb_set(
            config,
            ${sql.raw(aggregatePathLiteral(input.key))},
            ${JSON.stringify(input.value)}::jsonb,
            true
          )
      WHERE id = ${input.swarmId}
    `);
  }

  /**
   * Transition a swarm to a terminal status and optionally attach the
   * promoted suggestion/report ids produced by aggregation.
   */
  async closeSwarm(input: CloseSimSwarmInput): Promise<void> {
    const patch: {
      status: "done" | "failed";
      completedAt: Date;
      suggestionId?: bigint | null;
      outcomeReportFindingId?: bigint | null;
    } = {
      status: input.status,
      completedAt: input.completedAt ?? new Date(),
    };
    if (input.suggestionId !== undefined) {
      patch.suggestionId = input.suggestionId;
    }
    if (input.reportFindingId !== undefined) {
      patch.outcomeReportFindingId = input.reportFindingId;
    }
    await this.db
      .update(simSwarm)
      .set(patch)
      .where(eq(simSwarm.id, input.swarmId));
  }
}

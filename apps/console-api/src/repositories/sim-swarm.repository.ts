/**
 * SimSwarmRepository — narrow SQL over the `sim_swarm` table.
 *
 * Consumers:
 *   - `services/sim-launch.service.ts` → insert on swarm launch
 *   - `controllers/sim.controller.ts` → findById + state transitions wired
 *     to routes under §5.2 of docs/superpowers/plans/2026-04-18-plan5-sim-http-contract.md
 *   - `services/sim-promotion.service.ts` → linkOutcome after aggregator promotes
 *
 * SRP: every method touches sim_swarm only. Cross-table operations
 * (abort cascades to sim_run, fish-counts aggregate over sim_run) live in
 * services, which orchestrate this repo with sim-run.repository.ts inside a
 * single transaction when required.
 *
 * Introduced: Plan 5 Task 1.A.1.
 */

import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { NewSimSwarm } from "@interview/db-schema";
import { simSwarm } from "@interview/db-schema";
import type {
  InsertSimSwarmInput,
  LinkOutcomeInput,
  SimSwarmRow,
} from "../types/sim-swarm.types";

export type { InsertSimSwarmInput, LinkOutcomeInput, SimSwarmRow };

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
    await this.db
      .update(simSwarm)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(simSwarm.id, swarmId));
  }

  /** Transition to status='failed' and stamp completed_at. */
  async markFailed(swarmId: bigint): Promise<void> {
    await this.db
      .update(simSwarm)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(simSwarm.id, swarmId));
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
}

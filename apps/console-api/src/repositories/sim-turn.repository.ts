/**
 * SimTurnRepository — narrow SQL over the `sim_turn` table plus the one
 * atomic batch operation that spans sim_turn + sim_agent_memory.
 *
 * Consumers:
 *   - `controllers/sim.controller.ts` → §5.3 routes (insertAgentTurn,
 *     insertGodTurn, batch, listGodEventsAtOrBefore, lastTurnCreatedAt)
 *   - `services/sim-orchestrator.service.ts` → god-event inject + standalone
 *     turn writes
 *   - `services/sim-promotion.service.ts` → loadSimTurn by id (findById)
 *
 * `persistTurnBatch` atomically writes N sim_turn rows + M sim_agent_memory
 * rows inside one transaction. It's the primary hot-path route exercised
 * by the DAG turn runner — N agents' turns + (N*(N-1) + N) memory rows per
 * turn, all or nothing.
 *
 * Introduced: Plan 5 Task 1.A.3.
 */

import { and, asc, desc, eq, gt, lte, max, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  NewSimAgentMemory,
  NewSimTurn,
} from "@interview/db-schema";
import { simAgentMemory, simTurn } from "@interview/db-schema";
import type {
  InsertAgentTurnInput,
  InsertGodTurnInput,
  PersistTurnBatchInput,
  RecentObservableRow,
  SimGodEventRow,
  SimMemoryBatchRow,
  SimTurnRow,
} from "../types/sim-turn.types";

export type {
  InsertAgentTurnInput,
  InsertGodTurnInput,
  PersistTurnBatchInput,
  RecentObservableRow,
  SimGodEventRow,
  SimMemoryBatchRow,
  SimTurnRow,
};

export class SimTurnRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /** Insert a single agent turn and return its bigint id. */
  async insertAgentTurn(input: InsertAgentTurnInput): Promise<bigint> {
    const row: NewSimTurn = {
      simRunId: input.simRunId,
      turnIndex: input.turnIndex,
      actorKind: "agent",
      agentId: input.agentId,
      action: input.action,
      rationale: input.rationale,
      observableSummary: input.observableSummary,
      llmCostUsd: input.llmCostUsd ?? null,
    };
    const [inserted] = await this.db
      .insert(simTurn)
      .values(row)
      .returning({ id: simTurn.id });
    if (!inserted) throw new Error("insert sim_turn (agent) returned no row");
    return inserted.id;
  }

  /**
   * Insert a god-channel turn (actor_kind='god', agent_id=null). Used for
   * god-event injection + pre-seeded perturbation god events.
   */
  async insertGodTurn(input: InsertGodTurnInput): Promise<bigint> {
    const row: NewSimTurn = {
      simRunId: input.simRunId,
      turnIndex: input.turnIndex,
      actorKind: "god",
      agentId: null,
      action: input.action,
      rationale: input.rationale,
      observableSummary: input.observableSummary,
      llmCostUsd: null,
    };
    const [inserted] = await this.db
      .insert(simTurn)
      .values(row)
      .returning({ id: simTurn.id });
    if (!inserted) throw new Error("insert sim_turn (god) returned no row");
    return inserted.id;
  }

  /** Load a single turn row by id. */
  async findById(simTurnId: bigint): Promise<SimTurnRow | null> {
    const rows = await this.db
      .select()
      .from(simTurn)
      .where(eq(simTurn.id, simTurnId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return toRow(r);
  }

  /** Full operator-facing timeline for a run, oldest first. */
  async listTimelineForRun(simRunId: bigint): Promise<SimTurnRow[]> {
    const rows = await this.db
      .select()
      .from(simTurn)
      .where(eq(simTurn.simRunId, simRunId))
      .orderBy(asc(simTurn.turnIndex), asc(simTurn.createdAt), asc(simTurn.id));
    return rows.map(toRow);
  }

  /**
   * Atomic persistence of N agent turns + M memory rows. One transaction,
   * all-or-nothing. Returns the inserted sim_turn ids in the same order
   * as `input.agentTurns` — callers (e.g. the DAG turn runner) rely on this
   * to map their per-agent result objects.
   *
   * The per-row INSERT + RETURNING preserves ordering deterministically.
   */
  async persistTurnBatch(input: PersistTurnBatchInput): Promise<bigint[]> {
    if (input.agentTurns.length === 0 && input.memoryRows.length === 0) {
      return [];
    }
    return this.db.transaction(async (tx) => {
      const simTurnIds: bigint[] = [];
      for (const t of input.agentTurns) {
        const row: NewSimTurn = {
          simRunId: t.simRunId,
          turnIndex: t.turnIndex,
          actorKind: "agent",
          agentId: t.agentId,
          action: t.action,
          rationale: t.rationale,
          observableSummary: t.observableSummary,
          llmCostUsd: t.llmCostUsd ?? null,
        };
        const [inserted] = await tx
          .insert(simTurn)
          .values(row)
          .returning({ id: simTurn.id });
        if (!inserted) {
          throw new Error("persistTurnBatch: insert sim_turn returned no row");
        }
        simTurnIds.push(inserted.id);
      }

      if (input.memoryRows.length > 0) {
        const memoryInserts: NewSimAgentMemory[] = input.memoryRows.map((m) => ({
          simRunId: m.simRunId,
          agentId: m.agentId,
          turnIndex: m.turnIndex,
          kind: m.kind,
          content: m.content,
          embedding: m.embedding ?? null,
        }));
        await tx.insert(simAgentMemory).values(memoryInserts);
      }

      return simTurnIds;
    });
  }

  /**
   * God events whose turn_index ≤ `turnIndex`, oldest first, for the agent
   * context assembly in turn runners. Default limit 10 mirrors the legacy
   * hard-cap in the kernel's `loadGodEvents`.
   */
  async listGodEventsAtOrBefore(
    simRunId: bigint,
    turnIndex: number,
    limit: number = 10,
  ): Promise<SimGodEventRow[]> {
    const rows = await this.db
      .select({
        turnIndex: simTurn.turnIndex,
        observableSummary: simTurn.observableSummary,
        action: simTurn.action,
      })
      .from(simTurn)
      .where(
        and(
          eq(simTurn.simRunId, simRunId),
          eq(simTurn.actorKind, "god"),
          lte(simTurn.turnIndex, turnIndex),
        ),
      )
      .orderBy(asc(simTurn.turnIndex))
      .limit(limit);
    return rows.map((r) => ({
      turnIndex: r.turnIndex,
      observableSummary: r.observableSummary,
      action: r.action,
    }));
  }

  /** MAX(created_at) across this run's turns. Null when no turns exist. */
  async lastTurnCreatedAt(simRunId: bigint): Promise<Date | null> {
    const rows = await this.db
      .select({ lastAt: max(simTurn.createdAt) })
      .from(simTurn)
      .where(eq(simTurn.simRunId, simRunId));
    return rows[0]?.lastAt ?? null;
  }

  /**
   * Count agent turns in a run (actor_kind='agent'). Used by the
   * orchestrator's schedule-next arithmetic (turnsPlayed = ceil(count / agentCount)).
   */
  async countAgentTurnsForRun(simRunId: bigint): Promise<number> {
    const rows = await this.db.execute<{ c: number }>(sql`
      SELECT count(*)::int AS c
      FROM sim_turn
      WHERE sim_run_id = ${simRunId} AND actor_kind = 'agent'
    `);
    return rows.rows[0]?.c ?? 0;
  }

  /**
   * Recent turns visible across the fish — used to build the observable
   * timeline block of a turn prompt. Never returns rationale, only the
   * `observable_summary` plus actor identity.
   *
   * Scoped by sim_run_id. `sinceTurnIndex` is an exclusive lower bound
   * (pass -1 to include everything). `excludeAgentId` drops self-authored
   * turns for the requesting agent. Ordered newest-first, capped by
   * `limit`.
   *
   * Consumed by `GET /api/sim/runs/:simRunId/observable` (§5.4 of the
   * Plan 5 HTTP contract). Author-label composition (agentId → operator
   * name) happens in a separate call against the SSA fleet surface; the
   * repo returns raw sim_turn columns only.
   */
  async recentObservable(opts: {
    simRunId: bigint;
    sinceTurnIndex: number;
    excludeAgentId?: bigint;
    limit: number;
  }): Promise<RecentObservableRow[]> {
    const conditions = [
      eq(simTurn.simRunId, opts.simRunId),
      gt(simTurn.turnIndex, opts.sinceTurnIndex),
    ];
    if (opts.excludeAgentId !== undefined) {
      conditions.push(ne(simTurn.agentId, opts.excludeAgentId));
    }
    const rows = await this.db
      .select({
        turnIndex: simTurn.turnIndex,
        actorKind: simTurn.actorKind,
        agentId: simTurn.agentId,
        observableSummary: simTurn.observableSummary,
      })
      .from(simTurn)
      .where(and(...conditions))
      .orderBy(desc(simTurn.turnIndex))
      .limit(opts.limit);
    return rows.map((r) => ({
      turnIndex: r.turnIndex,
      actorKind: r.actorKind,
      agentId: r.agentId,
      observableSummary: r.observableSummary,
    }));
  }
}

function toRow(r: typeof simTurn.$inferSelect): SimTurnRow {
  return {
    id: r.id,
    simRunId: r.simRunId,
    turnIndex: r.turnIndex,
    actorKind: r.actorKind,
    agentId: r.agentId,
    action: r.action,
    rationale: r.rationale,
    observableSummary: r.observableSummary,
    llmCostUsd: r.llmCostUsd,
    createdAt: r.createdAt,
  };
}

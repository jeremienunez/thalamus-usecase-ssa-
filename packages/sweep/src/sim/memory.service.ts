/**
 * Agent memory — append-only pgvector store scoped by (sim_run_id, agent_id).
 *
 * Invariant: every query is filtered by sim_run_id first. Fish must not
 * bleed into each other, so a memory row written for (run=A, agent=X) is
 * unreachable from any turn in (run=B, agent=X) even if the semantic
 * content is similar.
 *
 * Embedding is best-effort: if the embedder returns null (Voyage unset,
 * API failure), the row is inserted with embedding=NULL. Vector search
 * will skip it, but `recentObservable` and keyword paths still find it.
 */

import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Database, MemoryKind, NewSimAgentMemory } from "@interview/db-schema";
import { simAgentMemory, simTurn } from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";
import type { SimFleetProvider } from "./ports";

const logger = createLogger("sim-memory");

export type EmbedFn = (text: string) => Promise<number[] | null>;

export interface MemoryRow {
  id: number;
  turnIndex: number;
  kind: MemoryKind;
  content: string;
  score?: number;
}

export interface ObservableTurnRow {
  turnIndex: number;
  actorKind: "agent" | "god" | "system";
  agentId: number | null;
  operatorName: string | null;
  observableSummary: string;
}

export interface WriteMemoryInput {
  simRunId: number;
  agentId: number;
  turnIndex: number;
  kind: MemoryKind;
  content: string;
}

export interface TopKOpts {
  simRunId: number;
  agentId: number;
  query: string;
  k?: number;
}

export interface RecentObservableOpts {
  simRunId: number;
  sinceTurnIndex: number;       // exclusive lower bound; pass -1 to get all
  excludeAgentId?: number;
  limit?: number;
}

export class MemoryService {
  constructor(
    private readonly db: Database,
    private readonly embed: EmbedFn,
    private readonly fleet: SimFleetProvider,
  ) {}

  /**
   * Append one memory row. Embedding is attempted but not required.
   * Returns the inserted id.
   */
  async write(input: WriteMemoryInput): Promise<number> {
    const vec = await this.safelyEmbed(input.content);
    const row: NewSimAgentMemory = {
      simRunId: BigInt(input.simRunId),
      agentId: BigInt(input.agentId),
      turnIndex: input.turnIndex,
      kind: input.kind,
      content: input.content,
      embedding: vec ?? null,
    };
    const [inserted] = await this.db
      .insert(simAgentMemory)
      .values(row)
      .returning({ id: simAgentMemory.id });
    if (!inserted) throw new Error("Failed to insert sim_agent_memory");
    return Number(inserted.id);
  }

  /**
   * Write a batch under a single round-trip. Used by the DAG reconciler
   * to persist self_action + N-1 observation rows in one go.
   */
  async writeMany(rows: WriteMemoryInput[]): Promise<number[]> {
    if (rows.length === 0) return [];
    const vectors = await Promise.all(rows.map((r) => this.safelyEmbed(r.content)));
    const inserts: NewSimAgentMemory[] = rows.map((r, i) => ({
      simRunId: BigInt(r.simRunId),
      agentId: BigInt(r.agentId),
      turnIndex: r.turnIndex,
      kind: r.kind,
      content: r.content,
      embedding: vectors[i] ?? null,
    }));
    const out = await this.db
      .insert(simAgentMemory)
      .values(inserts)
      .returning({ id: simAgentMemory.id });
    return out.map((r) => Number(r.id));
  }

  /**
   * Top-K memories for (simRunId, agentId) ranked by cosine similarity
   * to the query string. Scope filter is applied BEFORE the ANN search
   * (invariant: no cross-fish bleed).
   *
   * If the embedder returns null, falls back to the most recent K rows
   * for the scope — guarantees non-empty context even without Voyage.
   */
  async topK(opts: TopKOpts): Promise<MemoryRow[]> {
    const k = opts.k ?? 8;
    const qvec = await this.safelyEmbed(opts.query);

    if (!qvec) {
      const rows = await this.db
        .select({
          id: simAgentMemory.id,
          turnIndex: simAgentMemory.turnIndex,
          kind: simAgentMemory.kind,
          content: simAgentMemory.content,
        })
        .from(simAgentMemory)
        .where(
          and(
            eq(simAgentMemory.simRunId, BigInt(opts.simRunId)),
            eq(simAgentMemory.agentId, BigInt(opts.agentId)),
          ),
        )
        .orderBy(desc(simAgentMemory.turnIndex))
        .limit(k);
      return rows.map((r) => ({
        id: Number(r.id),
        turnIndex: r.turnIndex,
        kind: r.kind as MemoryKind,
        content: r.content,
      }));
    }

    // Drizzle raw SQL for pgvector `<=>` cosine distance.
    // Scope filter comes first; the HNSW index on embedding still serves.
    const vecLiteral = `[${qvec.join(",")}]`;
    const res = await this.db.execute(sql`
      SELECT id, turn_index, kind, content,
             1 - (embedding <=> ${vecLiteral}::vector) AS score
      FROM sim_agent_memory
      WHERE sim_run_id = ${BigInt(opts.simRunId)}
        AND agent_id   = ${BigInt(opts.agentId)}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vecLiteral}::vector
      LIMIT ${k}
    `);
    return (res.rows as Array<{
      id: string | number;
      turn_index: number;
      kind: MemoryKind;
      content: string;
      score: number;
    }>).map((r) => ({
      id: Number(r.id),
      turnIndex: r.turn_index,
      kind: r.kind,
      content: r.content,
      score: r.score,
    }));
  }

  /**
   * Recent turns visible to any agent in this fish — used to build the
   * "observable timeline" block of a turn prompt. Never returns rationale,
   * only the observableSummary column plus the actor label.
   */
  async recentObservable(opts: RecentObservableOpts): Promise<ObservableTurnRow[]> {
    const limit = opts.limit ?? 20;
    const lowerBound = opts.sinceTurnIndex;

    const rows = await this.db
      .select({
        turnIndex: simTurn.turnIndex,
        actorKind: simTurn.actorKind,
        agentId: simTurn.agentId,
        observableSummary: simTurn.observableSummary,
      })
      .from(simTurn)
      .where(
        and(
          eq(simTurn.simRunId, BigInt(opts.simRunId)),
          gt(simTurn.turnIndex, lowerBound),
        ),
      )
      .orderBy(desc(simTurn.turnIndex))
      .limit(limit);

    const filtered = opts.excludeAgentId
      ? rows.filter((r) => r.agentId === null || Number(r.agentId) !== opts.excludeAgentId)
      : rows;

    const authorLabels = await this.lookupAuthorLabels(
      filtered
        .map((r) => (r.agentId !== null ? Number(r.agentId) : null))
        .filter((x): x is number => x !== null),
    );

    return filtered.map((r) => ({
      turnIndex: r.turnIndex,
      actorKind: r.actorKind as "agent" | "god" | "system",
      agentId: r.agentId !== null ? Number(r.agentId) : null,
      operatorName:
        r.agentId !== null ? authorLabels.get(Number(r.agentId)) ?? null : null,
      observableSummary: r.observableSummary,
    }));
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private async safelyEmbed(text: string): Promise<number[] | null> {
    try {
      return await this.embed(text);
    } catch (err) {
      logger.warn({ err }, "embed failed; proceeding with null embedding");
      return null;
    }
  }

  private async lookupAuthorLabels(agentIds: number[]): Promise<Map<number, string>> {
    // Plan 2 · B.1: delegated to the SimFleetProvider port. SQL moved to
    // apps/console-api/src/repositories/satellite-fleet.repository.ts (SSA)
    // or packages/sweep/src/sim/legacy-ssa-fleet.ts (fallback).
    return this.fleet.getAuthorLabels(agentIds);
  }
}

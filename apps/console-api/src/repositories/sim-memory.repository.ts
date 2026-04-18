/**
 * SimMemoryRepository — narrow SQL over the `sim_agent_memory` table.
 *
 * Append-only pgvector store scoped by (sim_run_id, agent_id). Every
 * method enforces the scope invariant at the SQL level — fish must not
 * bleed into each other, so a memory written for (run=A, agent=X) is
 * unreachable from any turn in (run=B, agent=X) even if the semantic
 * content is similar.
 *
 * Embedding is pre-computed by callers (EmbedFn wrapper in
 * `services/sim-memory.service.ts` or kernel-side). The repository is a
 * pure storage + search layer — it never calls Voyage.
 *
 * Consumers:
 *   - `controllers/sim.controller.ts` → §5.4 routes (batch write + topK)
 *   - Plan 3 cutover: the kernel's MemoryService wraps these via the
 *     HTTP memory.adapter.ts (Phase 2).
 *
 * Introduced: Plan 5 Task 1.A.5.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { MemoryKind, NewSimAgentMemory } from "@interview/db-schema";
import { simAgentMemory } from "@interview/db-schema";
import type {
  SimMemoryRow,
  SimMemoryTopKByRecencyOpts,
  SimMemoryTopKByVectorOpts,
  SimMemoryWriteRow,
} from "../types/sim-memory.types";

export type {
  SimMemoryRow,
  SimMemoryTopKByRecencyOpts,
  SimMemoryTopKByVectorOpts,
  SimMemoryWriteRow,
};

export class SimMemoryRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Batch-insert memory rows. Empty input returns an empty array. Rows
   * are returned in the same order as `rows`.
   */
  async writeMany(rows: SimMemoryWriteRow[]): Promise<bigint[]> {
    if (rows.length === 0) return [];
    return this.db.transaction(async (tx) => {
      const ids: bigint[] = [];
      for (const r of rows) {
        const insert: NewSimAgentMemory = {
          simRunId: r.simRunId,
          agentId: r.agentId,
          turnIndex: r.turnIndex,
          kind: r.kind,
          content: r.content,
          embedding: r.embedding ?? null,
        };
        const [inserted] = await tx
          .insert(simAgentMemory)
          .values(insert)
          .returning({ id: simAgentMemory.id });
        if (!inserted) {
          throw new Error("writeMany: insert sim_agent_memory returned no row");
        }
        ids.push(inserted.id);
      }
      return ids;
    });
  }

  /**
   * Top-K memories for (simRunId, agentId) ranked by cosine similarity
   * to `vec`. Scope filter applied BEFORE the ANN search so the HNSW
   * index still serves while the invariant is preserved. Rows without an
   * embedding (insert-time failure) are skipped.
   *
   * `score` is `1 - cosine_distance`, mapped to [0,1] (1 = identical).
   */
  async topKByVector(opts: SimMemoryTopKByVectorOpts): Promise<SimMemoryRow[]> {
    const vecLiteral = `[${opts.vec.join(",")}]`;
    const rows = await this.db.execute<{
      id: string;
      turn_index: number;
      kind: MemoryKind;
      content: string;
      score: number;
    }>(sql`
      SELECT
        id::text,
        turn_index,
        kind,
        content,
        1 - (embedding <=> ${vecLiteral}::vector) AS score
      FROM sim_agent_memory
      WHERE sim_run_id = ${opts.simRunId}
        AND agent_id   = ${opts.agentId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vecLiteral}::vector
      LIMIT ${opts.k}
    `);
    return rows.rows.map((r) => ({
      id: BigInt(r.id),
      turnIndex: r.turn_index,
      kind: r.kind,
      content: r.content,
      score: r.score,
    }));
  }

  /**
   * Recency fallback — most recent K memories for (simRunId, agentId)
   * ordered by turn_index desc. Used when the embedder is unavailable
   * (Voyage unset, API failure) or when a caller explicitly wants the
   * recency stream.
   */
  async topKByRecency(opts: SimMemoryTopKByRecencyOpts): Promise<SimMemoryRow[]> {
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
          eq(simAgentMemory.simRunId, opts.simRunId),
          eq(simAgentMemory.agentId, opts.agentId),
        ),
      )
      .orderBy(desc(simAgentMemory.turnIndex))
      .limit(opts.k);
    return rows.map((r) => ({
      id: r.id,
      turnIndex: r.turnIndex,
      kind: r.kind,
      content: r.content,
    }));
  }
}

/**
 * Research Finding Repository — CRUD + semantic search for Thalamus findings
 */

import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import {
  researchFinding,
  researchEdge,
  researchCycleFinding,
  type DatabaseExecutor,
} from "@interview/db-schema";
import type { NewResearchFindingEntity } from "../entities/research.entity";
import type {
  ResearchFinding,
  NewResearchFinding,
} from "../types/research.types";
import { toResearchFinding } from "../transformers/research.transformer";
import {
  ResearchStatus,
  type ResearchFindingType,
} from "@interview/shared/enum";
import {
  assertEmbeddingDimension,
  type EmbeddingOperation,
} from "../errors/embedding";

export interface FindActiveOptions {
  cortex?: string;
  findingType?: ResearchFindingType;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

export class ResearchFindingRepository {
  constructor(private db: DatabaseExecutor) {}

  async create(data: NewResearchFinding): Promise<ResearchFinding> {
    validateRepositoryEmbedding(data.embedding, "createFinding");
    const [result] = await this.db
      .insert(researchFinding)
      .values(data as NewResearchFindingEntity)
      .returning();
    return toResearchFinding(result);
  }

  /**
   * Upsert by dedup hash — for daemon mode.
   * Returns `inserted: true` when a new row was created, `false` on hit-and-update.
   * Callers gate edge-write / cross-link side effects on `inserted` to avoid
   * unbounded duplicate edges when the same finding is re-emitted across cycles.
   */
  async upsertByDedupHash(
    data: NewResearchFinding,
  ): Promise<{ finding: ResearchFinding; inserted: boolean }> {
    validateRepositoryEmbedding(data.embedding, "upsertByDedupHash");
    if (!data.dedupHash) {
      return { finding: await this.create(data), inserted: true };
    }

    const [inserted] = await this.db
      .insert(researchFinding)
      .values(data as NewResearchFindingEntity)
      .onConflictDoNothing({
        target: researchFinding.dedupHash,
        where: sql`dedup_hash IS NOT NULL`,
      })
      .returning();

    if (inserted) {
      return { finding: toResearchFinding(inserted), inserted: true };
    }

    const [updated] = await this.db
      .update(researchFinding)
      .set({
        confidence: data.confidence,
        evidence: data.evidence,
        summary: data.summary,
        embedding: data.embedding,
        status: data.status ?? ResearchStatus.Active,
        updatedAt: new Date(),
        iteration: sql`${researchFinding.iteration} + 1`,
      })
      .where(eq(researchFinding.dedupHash, data.dedupHash))
      .returning();
    if (!updated) {
      throw new Error("Failed to upsert research finding by dedup hash");
    }
    return { finding: toResearchFinding(updated), inserted: false };
  }

  async findById(id: bigint): Promise<ResearchFinding | null> {
    const [result] = await this.db
      .select()
      .from(researchFinding)
      .where(eq(researchFinding.id, id))
      .limit(1);
    return result ? toResearchFinding(result) : null;
  }

  /**
   * Findings surfaced by a cycle, JOINed through `research_cycle_finding`.
   * This includes both NEW inserts and dedup-hit re-emissions — the dedup
   * flow merges content into a pre-existing finding row, so its
   * `research_cycle_id` column still points to the ORIGIN cycle. The
   * junction table is the source of truth for "what cycle N actually
   * surfaced", which is what the summariser needs.
   */
  async findByCycleId(cycleId: bigint): Promise<ResearchFinding[]> {
    const rows = await this.db
      .select()
      .from(researchFinding)
      .innerJoin(
        researchCycleFinding,
        eq(researchCycleFinding.researchFindingId, researchFinding.id),
      )
      .where(eq(researchCycleFinding.researchCycleId, cycleId))
      .orderBy(desc(researchFinding.confidence));
    return rows.map((r) => toResearchFinding(r.research_finding));
  }

  /**
   * Link a finding to a cycle in the junction table.
   * Idempotent: re-calling with the same (cycleId, findingId) is a no-op
   * thanks to the composite PK + ON CONFLICT DO NOTHING. Callers in the
   * graph service invoke this on every storeFinding regardless of whether
   * the underlying finding row was inserted or dedup-merged.
   */
  async linkToCycle(opts: {
    cycleId: bigint;
    findingId: bigint;
    iteration: number;
    isDedupHit: boolean;
  }): Promise<void> {
    await this.db
      .insert(researchCycleFinding)
      .values({
        researchCycleId: opts.cycleId,
        researchFindingId: opts.findingId,
        iteration: opts.iteration,
        isDedupHit: opts.isDedupHit,
      })
      .onConflictDoNothing();
  }

  /**
   * Find findings linked to an entity via research_edge JOIN
   */
  async findByEntity(
    entityType: string,
    entityId: bigint,
    opts?: { minConfidence?: number; limit?: number },
  ): Promise<ResearchFinding[]> {
    const conditions = [
      eq(researchEdge.entityType, entityType),
      eq(researchEdge.entityId, entityId),
      eq(researchFinding.status, "active"),
    ];

    if (opts?.minConfidence) {
      conditions.push(gte(researchFinding.confidence, opts.minConfidence));
    }

    const rows = await this.db
      .select({ finding: researchFinding })
      .from(researchFinding)
      .innerJoin(researchEdge, eq(researchEdge.findingId, researchFinding.id))
      .where(and(...conditions))
      .orderBy(desc(researchFinding.confidence))
      .limit(opts?.limit ?? 20);
    return rows.map((r) => toResearchFinding(r.finding));
  }

  /**
   * Semantic search via HNSW cosine on embedding column
   */
  async searchBySimilarity(
    embedding: number[],
    limit = 10,
  ): Promise<Array<ResearchFinding & { similarity: number }>> {
    validateRepositoryEmbedding(embedding, "searchBySimilarity");
    const results = await this.db.execute<
      ResearchFinding & { similarity: number } & Record<string, unknown>
    >(sql`
      SELECT rf.*,
        1.0 - (rf.embedding <=> ${JSON.stringify(embedding)}::halfvec) as similarity
      FROM research_finding rf
      WHERE rf.status = 'active'
        AND rf.embedding IS NOT NULL
      ORDER BY rf.embedding <=> ${JSON.stringify(embedding)}::halfvec
      LIMIT ${limit}
    `);
    return results.rows;
  }

  async findActive(opts: FindActiveOptions = {}): Promise<ResearchFinding[]> {
    const conditions = [eq(researchFinding.status, "active")];

    if (opts.cortex) conditions.push(eq(researchFinding.cortex, opts.cortex));
    if (opts.findingType)
      conditions.push(eq(researchFinding.findingType, opts.findingType));
    if (opts.minConfidence)
      conditions.push(gte(researchFinding.confidence, opts.minConfidence));

    const rows = await this.db
      .select()
      .from(researchFinding)
      .where(and(...conditions))
      .orderBy(
        desc(researchFinding.confidence),
        desc(researchFinding.createdAt),
      )
      .limit(opts.limit ?? 20)
      .offset(opts.offset ?? 0);
    return rows.map(toResearchFinding);
  }

  async archive(id: bigint): Promise<void> {
    await this.db
      .update(researchFinding)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(researchFinding.id, id));
  }

  /**
   * Find findings with embedding cosine similarity above threshold.
   * Uses HNSW index for fast approximate search.
   */
  async findSimilar(
    embedding: number[],
    threshold: number,
    limit: number,
    entityFilter?: { entityType: string; entityId: number | bigint },
  ): Promise<Array<ResearchFinding & { similarity: number }>> {
    validateRepositoryEmbedding(embedding, "findSimilar");
    const vectorStr = `[${embedding.join(",")}]`;
    // When entity filter is provided, only dedup within the SAME entity
    const entityClause = entityFilter
      ? sql` AND id IN (
          SELECT finding_id FROM research_edge
          WHERE entity_type = ${entityFilter.entityType}
            AND entity_id = ${entityFilter.entityId}
        )`
      : sql``;
    const results = await this.db.execute<
      ResearchFinding & { similarity: number } & Record<string, unknown>
    >(sql`
      SELECT *,
        (1.0 - (embedding <=> ${vectorStr}::halfvec)) as similarity
      FROM research_finding
      WHERE status = 'active'
        AND embedding IS NOT NULL
        AND (1.0 - (embedding <=> ${vectorStr}::halfvec)) >= ${threshold}
        ${entityClause}
      ORDER BY embedding <=> ${vectorStr}::halfvec ASC
      LIMIT ${limit}
    `);
    return results.rows;
  }

  /**
   * Merge new evidence into an existing finding (semantic dedup).
   * Updates confidence (max), appends evidence, increments iteration.
   */
  async mergeFinding(
    id: bigint,
    data: { confidence: number; evidence: unknown[] },
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE research_finding SET
        confidence = GREATEST(confidence, ${data.confidence}),
        evidence = evidence || ${JSON.stringify(data.evidence)}::jsonb,
        iteration = iteration + 1,
        updated_at = now()
      WHERE id = ${id}
    `);
  }

  /**
   * Archive findings past their TTL
   */
  async expireOld(): Promise<number> {
    const result = await this.db
      .update(researchFinding)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(researchFinding.status, "active"),
          lte(researchFinding.expiresAt, new Date()),
        ),
      );
    return result.rowCount ?? 0;
  }

  async countByCortexAndType(): Promise<
    Array<{ cortex: string; finding_type: string; cnt: number }>
  > {
    const result = await this.db.execute(sql`
      SELECT cortex, finding_type, count(*)::int as cnt
      FROM research_finding WHERE status = 'active'
      GROUP BY cortex, finding_type
    `);
    return result.rows as Array<{
      cortex: string;
      finding_type: string;
      cnt: number;
    }>;
  }

  async countRecent24h(): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT count(*)::int as cnt FROM research_finding
      WHERE status = 'active' AND created_at >= now() - interval '24 hours'
    `);
    return (result.rows[0] as { cnt: number })?.cnt ?? 0;
  }
}

function validateRepositoryEmbedding(
  embedding: number[] | null | undefined,
  operation: EmbeddingOperation,
): void {
  if (embedding === undefined) return;
  assertEmbeddingDimension(embedding, {
    embedderName: "ResearchFindingRepository",
    operation,
  });
}

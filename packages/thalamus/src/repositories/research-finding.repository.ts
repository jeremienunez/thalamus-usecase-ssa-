/**
 * Research Finding Repository — CRUD + semantic search for Thalamus findings
 */

import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import {
  researchFinding,
  researchEdge,
  type Database,
} from "@interview/db-schema";
import type {
  ResearchFinding,
  NewResearchFinding,
} from "../entities/research.entity";
import type {
  ResearchCortex,
  ResearchFindingType,
  ResearchEntityType,
} from "@interview/shared/enum";

export interface FindActiveOptions {
  cortex?: ResearchCortex;
  findingType?: ResearchFindingType;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

export class ResearchFindingRepository {
  constructor(private db: Database) {}

  async create(data: NewResearchFinding): Promise<ResearchFinding> {
    const [result] = await this.db
      .insert(researchFinding)
      .values(data)
      .returning();
    return result;
  }

  /**
   * Upsert by dedup hash — for daemon mode.
   * If an active finding with the same dedup_hash exists, update confidence + evidence.
   * Otherwise insert new.
   */
  async upsertByDedupHash(data: NewResearchFinding): Promise<ResearchFinding> {
    if (!data.dedupHash) {
      return this.create(data);
    }

    // Check if active finding with same dedup hash exists
    const [existing] = await this.db
      .select()
      .from(researchFinding)
      .where(
        and(
          eq(researchFinding.dedupHash, data.dedupHash),
          eq(researchFinding.status, "active"),
        ),
      )
      .limit(1);

    if (existing) {
      // Update existing finding
      const [updated] = await this.db
        .update(researchFinding)
        .set({
          confidence: data.confidence,
          evidence: data.evidence,
          summary: data.summary,
          embedding: data.embedding,
          updatedAt: new Date(),
          iteration: sql`${researchFinding.iteration} + 1`,
        })
        .where(eq(researchFinding.id, existing.id))
        .returning();
      return updated;
    }

    // Insert new finding
    return this.create(data);
  }

  async findById(id: bigint): Promise<ResearchFinding | null> {
    const [result] = await this.db
      .select()
      .from(researchFinding)
      .where(eq(researchFinding.id, id))
      .limit(1);
    return result ?? null;
  }

  async findByCycleId(cycleId: bigint): Promise<ResearchFinding[]> {
    return this.db
      .select()
      .from(researchFinding)
      .where(eq(researchFinding.researchCycleId, cycleId))
      .orderBy(desc(researchFinding.confidence));
  }

  /**
   * Find findings linked to an entity via research_edge JOIN
   */
  async findByEntity(
    entityType: ResearchEntityType,
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

    return this.db
      .select({ finding: researchFinding })
      .from(researchFinding)
      .innerJoin(researchEdge, eq(researchEdge.findingId, researchFinding.id))
      .where(and(...conditions))
      .orderBy(desc(researchFinding.confidence))
      .limit(opts?.limit ?? 20)
      .then((rows) => rows.map((r) => r.finding));
  }

  /**
   * Semantic search via HNSW cosine on embedding column
   */
  async searchBySimilarity(
    embedding: number[],
    limit = 10,
  ): Promise<Array<ResearchFinding & { similarity: number }>> {
    const results = await this.db.execute(sql`
      SELECT rf.*,
        1.0 - (rf.embedding <=> ${JSON.stringify(embedding)}::halfvec) as similarity
      FROM research_finding rf
      WHERE rf.status = 'active'
        AND rf.embedding IS NOT NULL
      ORDER BY rf.embedding <=> ${JSON.stringify(embedding)}::halfvec
      LIMIT ${limit}
    `);
    return results.rows as Array<ResearchFinding & { similarity: number }>;
  }

  async findActive(opts: FindActiveOptions = {}): Promise<ResearchFinding[]> {
    const conditions = [eq(researchFinding.status, "active")];

    if (opts.cortex) conditions.push(eq(researchFinding.cortex, opts.cortex));
    if (opts.findingType)
      conditions.push(eq(researchFinding.findingType, opts.findingType));
    if (opts.minConfidence)
      conditions.push(gte(researchFinding.confidence, opts.minConfidence));

    return this.db
      .select()
      .from(researchFinding)
      .where(and(...conditions))
      .orderBy(
        desc(researchFinding.confidence),
        desc(researchFinding.createdAt),
      )
      .limit(opts.limit ?? 20)
      .offset(opts.offset ?? 0);
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
    const vectorStr = `[${embedding.join(",")}]`;
    // When entity filter is provided, only dedup within the SAME entity
    const entityClause = entityFilter
      ? sql` AND id IN (
          SELECT finding_id FROM research_edge
          WHERE entity_type = ${entityFilter.entityType}
            AND entity_id = ${entityFilter.entityId}
        )`
      : sql``;
    const results = await this.db.execute(sql`
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
    return results.rows as unknown as Array<
      ResearchFinding & { similarity: number }
    >;
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

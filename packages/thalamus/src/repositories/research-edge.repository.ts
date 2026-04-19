/**
 * Research Edge Repository — Knowledge graph edge CRUD.
 *
 * Orphan cleanup is domain-specific and moved to `EntityCatalogPort`
 * adapters (e.g. `SsaEntityCatalogAdapter` on the app side).
 */

import { eq, and, sql, inArray } from "drizzle-orm";
import { researchEdge, type Database } from "@interview/db-schema";
import type { NewResearchEdgeEntity } from "../entities/research.entity";
import type {
  ResearchEdge,
  NewResearchEdge,
} from "../types/research.types";
import { toResearchEdge } from "../transformers/research.transformer";
import type { ResearchEntityType } from "@interview/shared/enum";

export class ResearchEdgeRepository {
  constructor(private db: Database) {}

  async createMany(edges: NewResearchEdge[]): Promise<ResearchEdge[]> {
    if (edges.length === 0) return [];
    const rows = await this.db
      .insert(researchEdge)
      .values(edges as NewResearchEdgeEntity[])
      .returning();
    return rows.map(toResearchEdge);
  }

  async findByFinding(findingId: bigint): Promise<ResearchEdge[]> {
    const rows = await this.db
      .select()
      .from(researchEdge)
      .where(eq(researchEdge.findingId, findingId));
    return rows.map(toResearchEdge);
  }

  async findByFindings(findingIds: bigint[]): Promise<ResearchEdge[]> {
    if (findingIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(researchEdge)
      .where(inArray(researchEdge.findingId, findingIds));
    return rows.map(toResearchEdge);
  }

  async findByEntity(
    entityType: ResearchEntityType,
    entityId: bigint,
  ): Promise<ResearchEdge[]> {
    const rows = await this.db
      .select()
      .from(researchEdge)
      .where(
        and(
          eq(researchEdge.entityType, entityType),
          eq(researchEdge.entityId, entityId),
        ),
      );
    return rows.map(toResearchEdge);
  }

  async countByEntityType(): Promise<
    Array<{ entity_type: string; cnt: number }>
  > {
    const result = await this.db.execute(sql`
      SELECT entity_type, count(*)::int as cnt
      FROM research_edge re
      INNER JOIN research_finding rf ON rf.id = re.finding_id AND rf.status = 'active'
      GROUP BY entity_type
    `);
    return result.rows as Array<{ entity_type: string; cnt: number }>;
  }
}

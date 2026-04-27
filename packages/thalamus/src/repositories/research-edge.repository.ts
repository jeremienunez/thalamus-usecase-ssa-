/**
 * Research Edge Repository — knowledge graph edge reads + writer delegation.
 *
 * Orphan cleanup is domain-specific and moved to `EntityCatalogPort`
 * adapters (e.g. `SsaEntityCatalogAdapter` on the app side).
 */

import { eq, and, sql, inArray } from "drizzle-orm";
import { researchEdge, type DatabaseExecutor } from "@interview/db-schema";
import type {
  ResearchEdge,
  NewResearchEdge,
} from "../types/research.types";
import { toResearchEdge } from "../transformers/research.transformer";
import type { ResearchWriterPort } from "../ports/research-writer.port";

export class ResearchEdgeRepository {
  constructor(
    private db: DatabaseExecutor,
    private writer: ResearchWriterPort,
  ) {}

  async createMany(edges: NewResearchEdge[]): Promise<ResearchEdge[]> {
    if (edges.length === 0) return [];
    return this.writer.createEdges(edges);
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
    entityType: string,
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

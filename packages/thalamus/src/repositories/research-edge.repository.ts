/**
 * Research Edge Repository — Knowledge graph edge CRUD + cleanup.
 *
 * Domain: SSA (Space Situational Awareness). Orphan-cleanup checks the
 * satellite / operator / orbit-regime family of tables.
 */

import { eq, and, sql, inArray } from "drizzle-orm";
import {
  researchEdge,
  researchFinding,
  satellite,
  operatorCountry,
  operator,
  satelliteBus,
  payload,
  orbitRegime,
  platformClass,
  type Database,
} from "@interview/db-schema";
import type { NewResearchEdgeEntity } from "../entities/research.entity";
import type {
  ResearchEdge,
  NewResearchEdge,
} from "../types/research.types";
import { toResearchEdge } from "../transformers/research.transformer";
import type { ResearchEntityType } from "@interview/shared/enum";

// Touch imports so tree-shaking can't drop them (they're part of the public
// knowledge-graph surface even if this file only references them via raw SQL).
void satellite;
void operatorCountry;
void operator;
void satelliteBus;
void payload;
void orbitRegime;
void platformClass;
void researchFinding;

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

  /**
   * Clean orphan edges whose target entity no longer exists.
   * Checks the SSA entity tables. Findings cleaned via CASCADE.
   */
  async cleanOrphans(): Promise<number> {
    const result = await this.db.execute(sql`
      DELETE FROM research_edge re
      WHERE NOT EXISTS (
        CASE re.entity_type
          WHEN 'satellite' THEN (SELECT 1 FROM satellite WHERE id = re.entity_id)
          WHEN 'operator_country' THEN (SELECT 1 FROM operator_country WHERE id = re.entity_id)
          WHEN 'operator' THEN (SELECT 1 FROM operator WHERE id = re.entity_id)
          WHEN 'launch' THEN (SELECT 1 FROM launch WHERE id = re.entity_id)
          WHEN 'satellite_bus' THEN (SELECT 1 FROM satellite_bus WHERE id = re.entity_id)
          WHEN 'payload' THEN (SELECT 1 FROM payload WHERE id = re.entity_id)
          WHEN 'orbit_regime' THEN (SELECT 1 FROM orbit_regime WHERE id = re.entity_id)
          WHEN 'platform_class' THEN (SELECT 1 FROM platform_class WHERE id = re.entity_id)
          WHEN 'finding' THEN (SELECT 1 FROM research_finding WHERE id = re.entity_id)
          ELSE NULL
        END
      )
    `);
    return result.rowCount ?? 0;
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

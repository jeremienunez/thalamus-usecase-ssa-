import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  EdgeRow,
  FindingEdgeDisplayRow,
  GraphNeighbourhoodRow,
} from "../types/finding.types";
import {
  researchEdgeEntityDisplayLabelExprSql,
  researchEdgeEntityDisplayLabelJoinsSql,
  researchEdgeEntityDisplayLabelSql,
  researchEdgeEntityLabelJoinsSql,
  researchEdgeEntityLabelSql,
} from "./research-edge-label.sql";

export type {
  EdgeRow,
  FindingEdgeDisplayRow,
  GraphNeighbourhoodRow,
} from "../types/finding.types";

export class KgEdgeViewRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findByFindingIds(ids: bigint[]): Promise<EdgeRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.execute<EdgeRow>(sql`
      SELECT
        re.finding_id::text,
        re.entity_type,
        ${researchEdgeEntityLabelSql}
      FROM research_edge re
      ${researchEdgeEntityLabelJoinsSql}
      WHERE re.finding_id = ANY(${sql`ARRAY[${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}]::bigint[]`})
    `);
    return rows.rows;
  }

  async findByFindingId(
    id: bigint,
    limit = 20,
  ): Promise<Array<{ entity_type: string; entity_id: string }>> {
    const rows = await this.db.execute<{
      entity_type: string;
      entity_id: string;
    }>(sql`
      SELECT
        re.entity_type,
        ${researchEdgeEntityLabelSql}
      FROM research_edge re
      ${researchEdgeEntityLabelJoinsSql}
      WHERE re.finding_id = ${id}
      LIMIT ${limit}
    `);
    return rows.rows;
  }

  // ── Cortex-consumed reads (absorbed from cortices/queries/repl-inspection) ──

  async findEdgesByFindingId(
    findingId: bigint,
    limit = 10,
  ): Promise<FindingEdgeDisplayRow[]> {
    const rows = await this.db.execute<FindingEdgeDisplayRow>(sql`
      SELECT
        rf.title AS from_name,
        re.relation::text AS relation,
        ${researchEdgeEntityDisplayLabelSql}
      FROM research_edge re
      JOIN research_finding rf
        ON rf.id = re.finding_id
      ${researchEdgeEntityDisplayLabelJoinsSql}
      WHERE re.finding_id = ${findingId}
      ORDER BY re.created_at DESC, re.id DESC
      LIMIT ${limit}
    `);
    return rows.rows;
  }

  async findNeighbourhood(
    entity: string,
    limit = 20,
  ): Promise<GraphNeighbourhoodRow[]> {
    const pattern = `%${entity}%`;
    const rows = await this.db.execute<GraphNeighbourhoodRow>(sql`
      SELECT
        rf.title AS from_name,
        'finding'::text AS from_type,
        re.relation::text AS relation,
        ${researchEdgeEntityDisplayLabelSql},
        re.entity_type::text AS to_type,
        rf.confidence::real AS confidence
      FROM research_edge re
      JOIN research_finding rf
        ON rf.id = re.finding_id
      ${researchEdgeEntityDisplayLabelJoinsSql}
      WHERE rf.title ILIKE ${pattern}
         OR rf.summary ILIKE ${pattern}
         OR (
           re.entity_type <> 'finding'
           AND ${researchEdgeEntityDisplayLabelExprSql} ILIKE ${pattern}
         )
      ORDER BY rf.confidence DESC NULLS LAST, re.created_at DESC, re.id DESC
      LIMIT ${limit}
    `);
    return rows.rows;
  }
}

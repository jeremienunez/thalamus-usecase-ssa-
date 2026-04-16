import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type EdgeRow = {
  finding_id: string;
  entity_type: string;
  entity_id: string;
};

export type EdgeInsertInput = {
  findingId: bigint;
  entityType:
    | "satellite"
    | "operator"
    | "operator_country"
    | "payload"
    | "orbit_regime";
  entityId: bigint;
  relation:
    | "about"
    | "supports"
    | "contradicts"
    | "similar_to"
    | "derived_from";
  weight: number;
  context: unknown;
};

export class ResearchEdgeRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findByFindingIds(ids: string[]): Promise<EdgeRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.execute<EdgeRow>(sql`
      SELECT finding_id::text, entity_type, entity_id::text
      FROM research_edge
      WHERE finding_id::text = ANY(${sql`ARRAY[${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}]::text[]`})
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
      SELECT entity_type, entity_id::text
      FROM research_edge WHERE finding_id = ${id}
      LIMIT ${limit}
    `);
    return rows.rows;
  }

  async insert(input: EdgeInsertInput): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO research_edge (finding_id, entity_type, entity_id, relation, weight, context)
      VALUES (${input.findingId}::bigint, ${input.entityType}::entity_type, ${input.entityId}::bigint,
              ${input.relation}::relation, ${input.weight}::real, ${JSON.stringify(input.context)}::jsonb)
    `);
  }
}

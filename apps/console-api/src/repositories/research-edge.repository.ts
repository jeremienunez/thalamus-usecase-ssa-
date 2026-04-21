import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  EdgeRow,
  EdgeInsertInput,
} from "../types/finding.types";

export type {
  EdgeRow,
  EdgeInsertInput,
} from "../types/finding.types";

export class ResearchEdgeRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findByFindingIds(ids: bigint[]): Promise<EdgeRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.execute<EdgeRow>(sql`
      SELECT
        re.finding_id::text,
        re.entity_type,
        CASE
          WHEN re.entity_type = 'operator'
            THEN COALESCE(op.name, re.entity_id::text)
          WHEN re.entity_type = 'orbit_regime'
            THEN COALESCE(r.name, re.entity_id::text)
          ELSE re.entity_id::text
        END AS entity_id
      FROM research_edge re
      LEFT JOIN operator op
        ON re.entity_type = 'operator' AND op.id = re.entity_id
      LEFT JOIN orbit_regime r
        ON re.entity_type = 'orbit_regime' AND r.id = re.entity_id
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
        CASE
          WHEN re.entity_type = 'operator'
            THEN COALESCE(op.name, re.entity_id::text)
          WHEN re.entity_type = 'orbit_regime'
            THEN COALESCE(r.name, re.entity_id::text)
          ELSE re.entity_id::text
        END AS entity_id
      FROM research_edge re
      LEFT JOIN operator op
        ON re.entity_type = 'operator' AND op.id = re.entity_id
      LEFT JOIN orbit_regime r
        ON re.entity_type = 'orbit_regime' AND r.id = re.entity_id
      WHERE re.finding_id = ${id}
      LIMIT ${limit}
    `);
    return rows.rows;
  }

  // ── Cortex-consumed reads (absorbed from cortices/queries/repl-inspection) ──

  async findEdgesByFindingId(
    findingId: bigint,
    limit = 10,
  ): Promise<Array<{ from_name: string; relation: string; to_name: string }>> {
    const rows = await this.db
      .execute(sql`
        SELECT from_name, relation, to_name
        FROM research_edge WHERE finding_id = ${findingId}
        LIMIT ${limit}
      `)
      .catch(() => ({ rows: [] as Array<unknown> }));
    return rows.rows as Array<{
      from_name: string;
      relation: string;
      to_name: string;
    }>;
  }

  async findNeighbourhood(
    entity: string,
    limit = 20,
  ): Promise<
    Array<{
      from_name: string;
      from_type: string;
      relation: string;
      to_name: string;
      to_type: string;
      confidence: number;
    }>
  > {
    const rows = await this.db.execute(sql`
      SELECT from_name, from_type, relation, to_name, to_type,
             confidence::real AS confidence
      FROM research_edge
      WHERE from_name ILIKE ${`%${entity}%`} OR to_name ILIKE ${`%${entity}%`}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return rows.rows as Array<{
      from_name: string;
      from_type: string;
      relation: string;
      to_name: string;
      to_type: string;
      confidence: number;
    }>;
  }

  async insert(input: EdgeInsertInput): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO research_edge (finding_id, entity_type, entity_id, relation, weight, context)
      VALUES (${input.findingId}::bigint, ${input.entityType}::entity_type, ${input.entityId}::bigint,
              ${input.relation}::relation, ${input.weight}::real, ${JSON.stringify(input.context)}::jsonb)
    `);
  }
}

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  KgSatRow,
  KgOpRow,
  KgRegimeRow,
  KgFindingRow,
  KgEdgeRow,
} from "../types/kg.types";

export type {
  KgSatRow,
  KgOpRow,
  KgRegimeRow,
  KgFindingRow,
  KgEdgeRow,
} from "../types/kg.types";

export class KgRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async loadNodeSources(): Promise<{
    sats: KgSatRow[];
    ops: KgOpRow[];
    regimes: KgRegimeRow[];
    findings: KgFindingRow[];
  }> {
    const [sats, ops, regimes, findings] = await Promise.all([
      this.db.execute<KgSatRow>(
        sql`SELECT id::text, name FROM satellite ORDER BY name LIMIT 120`,
      ),
      this.db.execute<KgOpRow>(
        sql`SELECT id::text, name FROM operator ORDER BY name`,
      ),
      this.db.execute<KgRegimeRow>(
        sql`SELECT id::text, name FROM orbit_regime ORDER BY name`,
      ),
      this.db.execute<KgFindingRow>(sql`
        SELECT id::text, title, cortex FROM research_finding
        ORDER BY created_at DESC LIMIT 80
      `),
    ]);
    return {
      sats: sats.rows,
      ops: ops.rows,
      regimes: regimes.rows,
      findings: findings.rows,
    };
  }

  async listRecentEdges(limit = 400): Promise<KgEdgeRow[]> {
    const rows = await this.db.execute<KgEdgeRow>(sql`
      SELECT
        re.id::text,
        re.finding_id::text,
        re.entity_type,
        CASE
          WHEN re.entity_type = 'operator'
            THEN COALESCE(op.name, re.entity_id::text)
          WHEN re.entity_type = 'orbit_regime'
            THEN COALESCE(r.name, re.entity_id::text)
          ELSE re.entity_id::text
        END AS entity_id,
        re.relation
      FROM research_edge re
      LEFT JOIN operator op
        ON re.entity_type = 'operator' AND op.id = re.entity_id
      LEFT JOIN orbit_regime r
        ON re.entity_type = 'orbit_regime' AND r.id = re.entity_id
      ORDER BY re.id DESC
      LIMIT ${limit}
    `);
    return rows.rows;
  }
}

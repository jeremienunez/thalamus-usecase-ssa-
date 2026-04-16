import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type KgSatRow = { id: string; name: string };
export type KgOpRow = { id: string; name: string };
export type KgRegimeRow = { id: string; name: string };
export type KgFindingRow = { id: string; title: string; cortex: string };
export type KgEdgeRow = {
  id: string;
  finding_id: string;
  entity_type: string;
  entity_id: string;
  relation: string;
};

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
      SELECT id::text, finding_id::text, entity_type, entity_id::text, relation
      FROM research_edge ORDER BY id DESC LIMIT ${limit}
    `);
    return rows.rows;
  }
}

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { AggregateCounts } from "../types/stats.types";

export type { AggregateCounts } from "../types/stats.types";

export class StatsRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async aggregates(): Promise<AggregateCounts> {
    const r = await this.db.execute<AggregateCounts>(sql`
      SELECT
        satellites,
        conjunctions,
        findings,
        kg_edges,
        research_cycles
      FROM vw_research_stats_counts
    `);
    return r.rows[0]!;
  }

  async findingsByStatus(): Promise<Array<{ status: string; count: number }>> {
    const r = await this.db.execute<{ status: string; count: number }>(sql`
      SELECT status, count FROM vw_research_findings_by_status
    `);
    return r.rows;
  }

  async findingsByCortex(): Promise<Array<{ cortex: string; count: number }>> {
    const r = await this.db.execute<{ cortex: string; count: number }>(sql`
      SELECT cortex, count FROM vw_research_findings_by_cortex
    `);
    return r.rows;
  }
}

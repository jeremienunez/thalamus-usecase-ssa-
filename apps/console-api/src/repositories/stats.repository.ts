import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { AggregateCounts } from "../types/stats.types";

export type { AggregateCounts, GroupedCount } from "../types/stats.types";

export class StatsRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async aggregates(): Promise<AggregateCounts> {
    const r = await this.db.execute<AggregateCounts>(sql`
      SELECT
        (SELECT count(*) FROM satellite)            AS satellites,
        (SELECT count(*) FROM conjunction_event)    AS conjunctions,
        (SELECT count(*) FROM research_finding)     AS findings,
        (SELECT count(*) FROM research_edge)        AS kg_edges,
        (SELECT count(*) FROM research_cycle)       AS research_cycles
    `);
    return r.rows[0]!;
  }

  async findingsByStatus(): Promise<Array<{ status: string; count: number }>> {
    const r = await this.db.execute<{ status: string; count: number }>(sql`
      SELECT status::text, count(*)::int FROM research_finding GROUP BY status
    `);
    return r.rows;
  }

  async findingsByCortex(): Promise<Array<{ cortex: string; count: number }>> {
    const r = await this.db.execute<{ cortex: string; count: number }>(sql`
      SELECT cortex::text, count(*)::int FROM research_finding GROUP BY cortex
    `);
    return r.rows;
  }
}

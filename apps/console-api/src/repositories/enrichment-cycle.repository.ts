// apps/console-api/src/repositories/enrichment-cycle.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export class EnrichmentCycleRepository {
  private cachedId: bigint | null = null;

  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /** Returns the single long-running catalog-enrichment cycle, creating it lazily. */
  async getOrCreate(): Promise<bigint> {
    if (this.cachedId != null) return this.cachedId;
    const existing = await this.db.execute<{ id: string }>(sql`
      SELECT id::text FROM research_cycle
      WHERE trigger_source = 'catalog-enrichment'
      ORDER BY id DESC LIMIT 1
    `);
    if (existing.rows[0]) {
      this.cachedId = BigInt(existing.rows[0].id);
      return this.cachedId;
    }
    const created = await this.db.execute<{ id: string }>(sql`
      INSERT INTO research_cycle (trigger_type, trigger_source, status, findings_count)
      VALUES ('system'::cycle_trigger, 'catalog-enrichment', 'running'::cycle_status, 0)
      RETURNING id::text
    `);
    this.cachedId = BigInt(created.rows[0]!.id);
    return this.cachedId;
  }
}

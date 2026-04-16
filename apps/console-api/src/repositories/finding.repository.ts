import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type FindingRow = {
  id: string;
  title: string;
  summary: string;
  cortex: string;
  status: string;
  confidence: number;
  created_at: Date | string;
  research_cycle_id: string;
};

export type FindingDetailRow = FindingRow & { evidence: unknown };

export type FindingInsertInput = {
  cycleId: bigint;
  cortex: string;
  findingType: string;
  urgency: string;
  title: string;
  summary: string;
  evidence: unknown;
  reasoning: string;
  confidence: number;
  impactScore: number;
};

export class FindingRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async list(filters: {
    status?: string;
    cortex?: string;
  }): Promise<FindingRow[]> {
    const { status, cortex } = filters;
    const rows = await this.db.execute<FindingRow>(sql`
      SELECT
        id::text, title, summary, cortex, status::text, confidence,
        created_at, research_cycle_id::text
      FROM research_finding
      WHERE ${status ? sql`status::text = ${status}` : sql`TRUE`}
        AND ${cortex ? sql`cortex::text = ${cortex}` : sql`TRUE`}
      ORDER BY created_at DESC
      LIMIT 300
    `);
    return rows.rows;
  }

  async findById(id: bigint): Promise<FindingDetailRow | null> {
    const rows = await this.db.execute<FindingDetailRow>(sql`
      SELECT id::text, title, summary, cortex, status::text, confidence, evidence, created_at,
             research_cycle_id::text
      FROM research_finding WHERE id = ${id}
    `);
    return rows.rows[0] ?? null;
  }

  async updateStatus(
    id: bigint,
    dbStatus: "active" | "archived" | "invalidated",
  ): Promise<boolean> {
    const updated = await this.db.execute<{ id: string }>(sql`
      UPDATE research_finding
      SET status = ${dbStatus}::finding_status, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id::text
    `);
    return updated.rows.length > 0;
  }

  async insert(input: FindingInsertInput): Promise<bigint> {
    const created = await this.db.execute<{ id: string }>(sql`
      INSERT INTO research_finding
        (research_cycle_id, cortex, finding_type, status, urgency,
         title, summary, evidence, reasoning, confidence, impact_score)
      VALUES
        (${input.cycleId}::bigint,
         ${input.cortex}::cortex,
         ${input.findingType}::finding_type,
         'active'::finding_status,
         ${input.urgency}::urgency,
         ${input.title}::text,
         ${input.summary}::text,
         ${JSON.stringify(input.evidence)}::jsonb,
         ${input.reasoning}::text,
         ${input.confidence}::real,
         ${input.impactScore}::real)
      RETURNING id::text
    `);
    return BigInt(created.rows[0]!.id);
  }
}

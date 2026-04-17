import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type {
  FindingRow,
  FindingDetailRow,
  FindingInsertInput,
} from "../types/finding.types";

export type {
  FindingRow,
  FindingDetailRow,
  FindingInsertInput,
} from "../types/finding.types";

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

  // ── Cortex-consumed reads (absorbed from cortices/queries/repl-inspection) ──

  async listByCycle(
    cycleId: bigint,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      title: string | null;
      summary: string | null;
      cortex: string | null;
      urgency: string | null;
      confidence: number | null;
    }>
  > {
    const rows = await this.db.execute(sql`
      SELECT id::text, title, summary, cortex::text AS cortex,
             urgency::text AS urgency, confidence::real AS confidence
      FROM research_finding
      WHERE research_cycle_id = ${cycleId}
      ORDER BY impact_score DESC NULLS LAST, confidence DESC NULLS LAST
      LIMIT ${limit}
    `);
    return rows.rows as Array<{
      id: string;
      title: string | null;
      summary: string | null;
      cortex: string | null;
      urgency: string | null;
      confidence: number | null;
    }>;
  }

  async listRecent(limit = 20): Promise<
    Array<{
      id: string;
      cortex: string;
      urgency: string | null;
      confidence: number;
      title: string;
    }>
  > {
    const rows = await this.db.execute(sql`
      SELECT id::text, cortex::text AS cortex, urgency::text AS urgency,
             confidence::real AS confidence, title
      FROM research_finding
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return rows.rows as Array<{
      id: string;
      cortex: string;
      urgency: string | null;
      confidence: number;
      title: string;
    }>;
  }

  async findDetailById(id: bigint): Promise<{
    id: string;
    title: string;
    cortex: string;
    urgency: string | null;
    confidence: number;
    evidence: unknown;
    summary: string;
  } | null> {
    const rows = await this.db.execute(sql`
      SELECT id::text, title, cortex::text AS cortex, urgency::text AS urgency,
             confidence::real AS confidence, evidence, summary
      FROM research_finding WHERE id = ${id}
    `);
    return (rows.rows[0] as {
      id: string;
      title: string;
      cortex: string;
      urgency: string | null;
      confidence: number;
      evidence: unknown;
      summary: string;
    }) ?? null;
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

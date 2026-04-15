/**
 * SQL helpers — SSA REPL inspection commands.
 *
 * Raw-SQL reads for the interactive CLI: findings lookup, graph
 * neighbourhood, why-button provenance. All inspection-only; writes
 * belong to repositories/ or services.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";

export interface ReplFindingRow {
  id: bigint;
  title: string | null;
  summary: string | null;
  cortex: string | null;
  urgency: string | null;
  confidence: number | null;
}

export async function loadCycleFindings(
  db: Database,
  cycleId: bigint,
  limit: number,
): Promise<ReplFindingRow[]> {
  const rows = await db.execute(sql`
    SELECT id, title, summary, cortex::text AS cortex, urgency::text AS urgency,
           confidence::real AS confidence
    FROM research_finding
    WHERE research_cycle_id = ${cycleId}
    ORDER BY impact_score DESC NULLS LAST, confidence DESC NULLS LAST
    LIMIT ${limit}
  `);
  return (rows.rows as Array<{
    id: string;
    title: string | null;
    summary: string | null;
    cortex: string | null;
    urgency: string | null;
    confidence: number | null;
  }>).map((r) => ({
    id: BigInt(r.id),
    title: r.title,
    summary: r.summary,
    cortex: r.cortex,
    urgency: r.urgency,
    confidence: r.confidence,
  }));
}

export interface ReplRecentFinding {
  id: string;
  cortex: string;
  urgency: string | null;
  confidence: number;
  title: string;
}

export async function loadRecentFindings(
  db: Database,
  limit: number,
): Promise<ReplRecentFinding[]> {
  const rows = await db.execute(sql`
    SELECT id, cortex::text AS cortex, urgency::text AS urgency,
           confidence::real AS confidence, title
    FROM research_finding
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return rows.rows as unknown as ReplRecentFinding[];
}

export interface ReplGraphEdge {
  from_name: string;
  from_type: string;
  relation: string;
  to_name: string;
  to_type: string;
  confidence: number;
}

export async function loadGraphNeighbourhood(
  db: Database,
  entity: string,
): Promise<ReplGraphEdge[]> {
  const rows = await db.execute(sql`
    SELECT from_name, from_type, relation, to_name, to_type, confidence::real AS confidence
    FROM research_edge
    WHERE from_name ILIKE ${`%${entity}%`} OR to_name ILIKE ${`%${entity}%`}
    ORDER BY created_at DESC
    LIMIT 20
  `);
  return rows.rows as unknown as ReplGraphEdge[];
}

export interface ReplFindingDetail {
  id: string;
  title: string;
  cortex: string;
  urgency: string | null;
  confidence: number;
  evidence: unknown;
  summary: string;
}

export async function loadFindingDetail(
  db: Database,
  findingId: bigint,
): Promise<ReplFindingDetail | undefined> {
  const rows = await db.execute(sql`
    SELECT id, title, cortex::text AS cortex, urgency::text AS urgency,
           confidence::real AS confidence, evidence, summary
    FROM research_finding WHERE id = ${findingId}
  `);
  return rows.rows[0] as unknown as ReplFindingDetail | undefined;
}

export interface ReplFindingEdge {
  from_name: string;
  relation: string;
  to_name: string;
}

export async function loadFindingEdges(
  db: Database,
  findingId: bigint,
): Promise<ReplFindingEdge[]> {
  const rows = await db
    .execute(sql`
      SELECT from_name, relation, to_name
      FROM research_edge WHERE finding_id = ${findingId}
      LIMIT 10
    `)
    .catch(() => ({ rows: [] as Array<unknown> }));
  return rows.rows as unknown as ReplFindingEdge[];
}

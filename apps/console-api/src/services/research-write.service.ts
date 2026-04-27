/**
 * ResearchWriteService — single writer surface for `research_*` tables.
 *
 * Owns every `db.insert(research...)` call in the codebase. Kernel
 * repositories delegate via `ResearchWriterPort`; sim-promotion consumes the
 * same writer directly. No other path may write to research_cycle / research_finding /
 * research_edge / research_cycle_finding (CLAUDE.md §3.1, §3.2).
 */
import { eq, sql } from "drizzle-orm";
import {
  type Database,
  researchCycle,
  researchCycleFinding,
  researchEdge,
  researchFinding,
  type DatabaseExecutor,
} from "@interview/db-schema";
import type {
  ResearchCycle,
  ResearchEdge,
  ResearchFindingEmissionInput,
  ResearchFindingEmissionResult,
  ResearchFinding,
  ResearchWriterPort,
} from "@interview/thalamus";

type ResearchWriterDb = DatabaseExecutor & Partial<Pick<Database, "transaction">>;

export function createResearchWriter(
  db: ResearchWriterDb,
): ResearchWriterPort {
  const writer: ResearchWriterPort = {
    async createCycle(value) {
      const [row] = await db
        .insert(researchCycle)
        .values(value)
        .returning();
      if (!row) throw new Error("insert research_cycle returned no row");
      return toResearchCycle(row);
    },

    async incrementCycleFindings(cycleId) {
      await db
        .update(researchCycle)
        .set({ findingsCount: sql`${researchCycle.findingsCount} + 1` })
        .where(eq(researchCycle.id, cycleId));
    },

    async updateCycleFindingsCount(cycleId, findingsCount) {
      await db
        .update(researchCycle)
        .set({ findingsCount })
        .where(eq(researchCycle.id, cycleId));
    },

    async createEdges(values) {
      if (values.length === 0) return [];
      const rows = await db
        .insert(researchEdge)
        .values(values)
        .returning();
      return rows.map(toResearchEdge);
    },

    async createFinding(value) {
      const [row] = await db
        .insert(researchFinding)
        .values(value)
        .returning();
      if (!row) throw new Error("insert research_finding returned no row");
      return toResearchFinding(row);
    },

    async upsertFindingByDedupHash(value) {
      const [inserted] = await db
        .insert(researchFinding)
        .values(value)
        .onConflictDoNothing({
          target: researchFinding.dedupHash,
          where: sql`dedup_hash IS NOT NULL`,
        })
        .returning();

      if (inserted) {
        return { row: toResearchFinding(inserted), inserted: true };
      }

      const [updated] = await db
        .update(researchFinding)
        .set({
          confidence: value.confidence,
          evidence: value.evidence,
          summary: value.summary,
          embedding: value.embedding,
          status: value.status,
          updatedAt: new Date(),
          iteration: sql`${researchFinding.iteration} + 1`,
        })
        .where(eq(researchFinding.dedupHash, value.dedupHash!))
        .returning();
      if (!updated) {
        throw new Error("Failed to upsert research finding by dedup hash");
      }
      return { row: toResearchFinding(updated), inserted: false };
    },

    async linkFindingToCycle(opts) {
      const rows = await db
        .insert(researchCycleFinding)
        .values({
          researchCycleId: opts.cycleId,
          researchFindingId: opts.findingId,
          iteration: opts.iteration,
          isDedupHit: opts.isDedupHit,
        })
        .onConflictDoNothing()
        .returning({
          researchFindingId: researchCycleFinding.researchFindingId,
      });
      return rows.length > 0;
    },

    async emitFindingTransactional(input) {
      if (typeof db.transaction === "function") {
        return db.transaction((tx) =>
          emitFindingWithWriter(createResearchWriter(tx), input),
        );
      }
      return emitFindingWithWriter(writer, input);
    },
  };

  return writer;
}

function toResearchCycle(row: typeof researchCycle.$inferSelect): ResearchCycle {
  return {
    ...row,
    triggerType: row.triggerType as ResearchCycle["triggerType"],
    status: row.status as ResearchCycle["status"],
  };
}

function toResearchFinding(
  row: typeof researchFinding.$inferSelect,
): ResearchFinding {
  return {
    ...row,
    findingType: row.findingType as ResearchFinding["findingType"],
    status: row.status as ResearchFinding["status"],
    urgency: row.urgency as ResearchFinding["urgency"],
    extensions: row.extensions as ResearchFinding["extensions"],
  };
}

function toResearchEdge(row: typeof researchEdge.$inferSelect): ResearchEdge {
  return {
    ...row,
    relation: row.relation as ResearchEdge["relation"],
  };
}

async function emitFindingWithWriter(
  writer: ResearchWriterPort,
  input: ResearchFindingEmissionInput,
): Promise<ResearchFindingEmissionResult> {
  const findingResult = await writer.upsertFindingByDedupHash(input.finding);
  const linked = await writer.linkFindingToCycle({
    cycleId: input.link.cycleId,
    findingId: findingResult.row.id,
    iteration: input.link.iteration ?? 0,
    isDedupHit: !findingResult.inserted,
  });
  const edges =
    input.edges && input.edges.length > 0
      ? await writer.createEdges(
          input.edges.map((edge) => ({
            ...edge,
            findingId: findingResult.row.id,
          })),
        )
      : [];

  return {
    finding: findingResult.row,
    inserted: findingResult.inserted,
    linked,
    edges,
  };
}

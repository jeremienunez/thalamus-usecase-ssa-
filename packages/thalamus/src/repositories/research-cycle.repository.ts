/**
 * Research Cycle Repository — CRUD for Thalamus research cycles
 */

import { eq, desc, sql } from "drizzle-orm";
import { researchCycle, type Database } from "@interview/db-schema";
import type {
  ResearchCycle,
  NewResearchCycle,
} from "../entities/research.entity";
import type { ResearchCycleStatus } from "@interview/shared/enum";

export class ResearchCycleRepository {
  constructor(private db: Database) {}

  async create(data: NewResearchCycle): Promise<ResearchCycle> {
    const [result] = await this.db
      .insert(researchCycle)
      .values(data)
      .returning();
    return result;
  }

  async findById(id: bigint): Promise<ResearchCycle | null> {
    const [result] = await this.db
      .select()
      .from(researchCycle)
      .where(eq(researchCycle.id, id))
      .limit(1);
    return result ?? null;
  }

  async updateStatus(
    id: bigint,
    status: ResearchCycleStatus,
    opts?: { completedAt?: Date; error?: string; totalCost?: number },
  ): Promise<void> {
    await this.db
      .update(researchCycle)
      .set({
        status,
        completedAt: opts?.completedAt,
        error: opts?.error,
        totalCost: opts?.totalCost,
      })
      .where(eq(researchCycle.id, id));
  }

  async incrementFindings(id: bigint): Promise<void> {
    await this.db
      .update(researchCycle)
      .set({
        findingsCount: sql`${researchCycle.findingsCount} + 1`,
      })
      .where(eq(researchCycle.id, id));
  }

  async findRecent(limit = 20): Promise<ResearchCycle[]> {
    return this.db
      .select()
      .from(researchCycle)
      .orderBy(desc(researchCycle.startedAt))
      .limit(limit);
  }
}

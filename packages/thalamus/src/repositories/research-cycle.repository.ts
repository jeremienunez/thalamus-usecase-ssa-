/**
 * Research Cycle Repository — CRUD for Thalamus research cycles
 */

import { eq, desc } from "drizzle-orm";
import { researchCycle, type DatabaseExecutor } from "@interview/db-schema";
import type {
  ResearchCycle,
  NewResearchCycle,
} from "../types/research.types";
import { toResearchCycle } from "../transformers/research.transformer";
import type { ResearchCycleStatus } from "@interview/shared/enum";
import type { ResearchWriterPort } from "../ports/research-writer.port";

export class ResearchCycleRepository {
  constructor(
    private db: DatabaseExecutor,
    private writer: ResearchWriterPort,
  ) {}

  async create(data: NewResearchCycle): Promise<ResearchCycle> {
    return this.writer.createCycle(data);
  }

  async findById(id: bigint): Promise<ResearchCycle | null> {
    const [result] = await this.db
      .select()
      .from(researchCycle)
      .where(eq(researchCycle.id, id))
      .limit(1);
    return result ? toResearchCycle(result) : null;
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
    await this.writer.incrementCycleFindings(id);
  }

  async findRecent(limit = 20): Promise<ResearchCycle[]> {
    const rows = await this.db
      .select()
      .from(researchCycle)
      .orderBy(desc(researchCycle.startedAt))
      .limit(limit);
    return rows.map(toResearchCycle);
  }
}

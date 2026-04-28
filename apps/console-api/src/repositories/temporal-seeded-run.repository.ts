import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import {
  temporalPatternSeededRun,
  type NewTemporalPatternSeededRun,
} from "@interview/db-schema";
import type {
  InsertTemporalPatternSeededRunInput,
  TemporalPatternSeededRunRow,
} from "../types/temporal.types";

export class TemporalSeededRunRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async insert(
    input: InsertTemporalPatternSeededRunInput,
  ): Promise<TemporalPatternSeededRunRow | null> {
    const row: NewTemporalPatternSeededRun = {
      patternId: input.patternId,
      simRunId: input.simRunId,
      seedReason: input.seedReason,
      sourceDomain: input.sourceDomain,
    };
    const [inserted] = await this.db
      .insert(temporalPatternSeededRun)
      .values(row)
      .onConflictDoNothing()
      .returning();
    return inserted ?? null;
  }
}

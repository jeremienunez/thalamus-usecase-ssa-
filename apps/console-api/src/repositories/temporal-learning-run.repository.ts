import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import {
  temporalLearningRun,
  type NewTemporalLearningRun,
} from "@interview/db-schema";
import type {
  CreateTemporalLearningRunInput,
  TemporalLearningRunRow,
} from "../types/temporal.types";

export class TemporalLearningRunRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async create(input: CreateTemporalLearningRunInput): Promise<TemporalLearningRunRow> {
    const row: NewTemporalLearningRun = {
      patternVersion: input.patternVersion,
      sourceDomain: input.sourceDomain,
      inputSnapshotHash: input.inputSnapshotHash,
      paramsJson: input.paramsJson,
      status: input.status ?? "running",
      metricsJson: {},
    };
    const [inserted] = await this.db
      .insert(temporalLearningRun)
      .values(row)
      .returning();
    if (!inserted) throw new Error("insert temporal_learning_run returned no row");
    return toRow(inserted);
  }

  async complete(
    learningRunId: bigint,
    metricsJson: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(temporalLearningRun)
      .set({
        status: "completed",
        metricsJson,
        completedAt: new Date(),
      })
      .where(eq(temporalLearningRun.id, learningRunId));
  }

  async fail(
    learningRunId: bigint,
    metricsJson: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(temporalLearningRun)
      .set({
        status: "failed",
        metricsJson,
        completedAt: new Date(),
      })
      .where(eq(temporalLearningRun.id, learningRunId));
  }
}

function toRow(row: typeof temporalLearningRun.$inferSelect): TemporalLearningRunRow {
  return {
    id: row.id,
    patternVersion: row.patternVersion,
    sourceDomain: row.sourceDomain,
    inputSnapshotHash: row.inputSnapshotHash,
    paramsJson: row.paramsJson,
    status: row.status,
    metricsJson: row.metricsJson,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import {
  temporalProjectionRun,
  type NewTemporalProjectionRun,
} from "@interview/db-schema";
import type {
  CreateTemporalProjectionRunInput,
  TemporalProjectionRunRow,
} from "../types/temporal.types";

export class TemporalProjectionRunRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async create(
    input: CreateTemporalProjectionRunInput,
  ): Promise<TemporalProjectionRunRow> {
    const row: NewTemporalProjectionRun = {
      projectionVersion: input.projectionVersion,
      sourceScope: input.sourceScope,
      fromTs: input.fromTs,
      toTs: input.toTs,
      inputSnapshotHash: input.inputSnapshotHash,
      status: input.status ?? "running",
      metricsJson: {},
    };
    const [inserted] = await this.db
      .insert(temporalProjectionRun)
      .values(row)
      .returning();
    if (!inserted) throw new Error("insert temporal_projection_run returned no row");
    return toRow(inserted);
  }

  async complete(
    projectionRunId: bigint,
    metricsJson: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(temporalProjectionRun)
      .set({
        status: "completed",
        metricsJson,
        completedAt: new Date(),
      })
      .where(eq(temporalProjectionRun.id, projectionRunId));
  }

  async fail(
    projectionRunId: bigint,
    metricsJson: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(temporalProjectionRun)
      .set({
        status: "failed",
        metricsJson,
        completedAt: new Date(),
      })
      .where(eq(temporalProjectionRun.id, projectionRunId));
  }
}

function toRow(
  row: typeof temporalProjectionRun.$inferSelect,
): TemporalProjectionRunRow {
  return {
    id: row.id,
    projectionVersion: row.projectionVersion,
    sourceScope: row.sourceScope,
    fromTs: row.fromTs,
    toTs: row.toTs,
    inputSnapshotHash: row.inputSnapshotHash,
    status: row.status,
    metricsJson: row.metricsJson,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

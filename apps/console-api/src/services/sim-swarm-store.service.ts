import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import type { SimRunStatus, SimSwarm } from "@interview/db-schema";
import { simRun, simSwarm } from "@interview/db-schema";
import type { SimSwarmStore } from "@interview/sweep";
import type { SimRunRepository } from "../repositories/sim-run.repository";
import type { SimSwarmRepository } from "../repositories/sim-swarm.repository";
import type { SimTerminalRepository } from "../repositories/sim-terminal.repository";

function aggregatePathLiteral(
  key: string,
): string {
  if (!/^[A-Za-z0-9_]+$/.test(key)) {
    throw new Error(`invalid aggregate path key: ${key}`);
  }
  return `'{${key}}'::text[]`;
}

export class SimSwarmStoreService implements SimSwarmStore {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly swarmRepo: Pick<SimSwarmRepository, "findById">,
    private readonly runRepo: Pick<SimRunRepository, "countFishByStatus">,
    private readonly terminalRepo: Pick<
      SimTerminalRepository,
      "listTerminalsForSwarm" | "listTerminalActionsForSwarm"
    >,
  ) {}

  async getSwarm(swarmId: number) {
    const row = await this.swarmRepo.findById(BigInt(swarmId));
    if (!row) return null;
    return {
      id: Number(row.id),
      kind: row.kind,
      title: row.title,
      baseSeed: row.baseSeed,
      size: row.size,
      config: row.config,
      status: row.status,
      outcomeReportFindingId:
        row.outcomeReportFindingId === null
          ? null
          : Number(row.outcomeReportFindingId),
      suggestionId:
        row.suggestionId === null ? null : Number(row.suggestionId),
    };
  }

  countFishByStatus(swarmId: number) {
    return this.runRepo.countFishByStatus(BigInt(swarmId));
  }

  async abortSwarm(swarmId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(simSwarm)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(simSwarm.id, BigInt(swarmId)));
      await tx
        .update(simRun)
        .set({ status: "failed", completedAt: new Date() })
        .where(
          and(
            eq(simRun.swarmId, BigInt(swarmId)),
            inArray(simRun.status, ["pending", "running"] as SimRunStatus[]),
          ),
        );
    });
  }

  async listTerminalsForSwarm(swarmId: number) {
    const rows = await this.terminalRepo.listTerminalsForSwarm(BigInt(swarmId));
    return rows.map((row) => ({
      simRunId: Number(row.simRunId),
      fishIndex: row.fishIndex,
      runStatus: row.runStatus,
      agentIndex: row.agentIndex,
      action: row.action,
      observableSummary: row.observableSummary,
      turnsPlayed: row.turnsPlayed,
    }));
  }

  async listTerminalActionsForSwarm(swarmId: number) {
    const rows = await this.terminalRepo.listTerminalActionsForSwarm(
      BigInt(swarmId),
    );
    return rows.map((row) => ({
      simRunId: Number(row.simRunId),
      runStatus: row.runStatus,
      action: row.action,
    }));
  }

  async snapshotAggregate(input: {
    swarmId: number;
    key: string;
    value: Record<string, unknown>;
  }): Promise<void> {
    await this.db.execute(sql`
      UPDATE sim_swarm
      SET config = jsonb_set(
            config,
            ${sql.raw(aggregatePathLiteral(input.key))},
            ${JSON.stringify(input.value)}::jsonb,
            true
          )
      WHERE id = ${BigInt(input.swarmId)}
    `);
  }

  async closeSwarm(input: {
    swarmId: number;
    status: "done" | "failed";
    suggestionId?: number | null;
    reportFindingId?: number | null;
    completedAt?: Date;
  }): Promise<void> {
    const patch: Partial<SimSwarm> = {
      status: input.status,
      completedAt: input.completedAt ?? new Date(),
    };
    if (input.suggestionId !== undefined) {
      patch.suggestionId =
        input.suggestionId === null ? null : BigInt(input.suggestionId);
    }
    if (input.reportFindingId !== undefined) {
      patch.outcomeReportFindingId =
        input.reportFindingId === null
          ? null
          : BigInt(input.reportFindingId);
    }
    await this.db
      .update(simSwarm)
      .set(patch)
      .where(eq(simSwarm.id, BigInt(input.swarmId)));
  }
}

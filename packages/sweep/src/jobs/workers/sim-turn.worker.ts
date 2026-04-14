/**
 * sim-turn BullMQ worker.
 *
 * One job = one turn of one sim_run. Loads the run, picks the driver based
 * on `sim_run.kind`, runs the turn, then asks the orchestrator to schedule
 * the next turn (unless the run is now done).
 *
 * Used by standalone / admin-interactive simulations. Swarm fish drain
 * turns inline inside their own worker and never hit this queue.
 */

import type { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import type { Database } from "@interview/db-schema";
import { simRun } from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";
import type { SimOrchestrator } from "../../sim/sim-orchestrator.service";
import type { SequentialTurnRunner } from "../../sim/turn-runner-sequential";
import type { DagTurnRunner } from "../../sim/turn-runner-dag";
import type { SimTurnJobPayload } from "../queues";
import { createWorker } from "./helpers";

const logger = createLogger("sim-turn-worker");

export interface SimTurnWorkerDeps {
  db: Database;
  orchestrator: SimOrchestrator;
  sequentialRunner: SequentialTurnRunner;
  dagRunner: DagTurnRunner;
  concurrency?: number;
}

export function createSimTurnWorker(
  deps: SimTurnWorkerDeps,
): Worker<SimTurnJobPayload> {
  return createWorker<SimTurnJobPayload>({
    name: "sim-turn",
    concurrency: deps.concurrency ?? 2,
    processor: async (job) => {
      const { simRunId, turnIndex } = job.data;

      const run = await deps.db
        .select({
          id: simRun.id,
          kind: simRun.kind,
          status: simRun.status,
        })
        .from(simRun)
        .where(eq(simRun.id, BigInt(simRunId)))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!run) {
        logger.warn({ simRunId, turnIndex }, "sim_run not found, dropping job");
        return { skipped: true, reason: "run_not_found" };
      }
      if (run.status !== "running") {
        logger.info(
          { simRunId, turnIndex, status: run.status },
          "sim_run not running, dropping turn",
        );
        return { skipped: true, reason: `status=${run.status}` };
      }

      // Route by kind.
      if (run.kind === "uc3_conjunction") {
        const r = await deps.sequentialRunner.runTurn({ simRunId, turnIndex });
        if (r.terminal) {
          logger.info(
            { simRunId, turnIndex, actionKind: r.action.kind },
            "UC3 terminal action — run closed by Sequential driver",
          );
          return { terminal: true, simTurnId: r.simTurnId };
        }
      } else if (run.kind === "uc1_operator_behavior") {
        await deps.dagRunner.runTurn({ simRunId, turnIndex });
      } else {
        throw new Error(`unknown sim_run.kind: ${String(run.kind)}`);
      }

      // Ask orchestrator to schedule the next turn (or close the run).
      const next = await deps.orchestrator.scheduleNext(simRunId);
      return { scheduled: next.scheduled, reason: next.reason };
    },
  });
}

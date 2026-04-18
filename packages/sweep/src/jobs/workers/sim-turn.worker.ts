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
import { createLogger } from "@interview/shared/observability";
import type { SimOrchestrator } from "../../sim/sim-orchestrator.service";
import type { SequentialTurnRunner } from "../../sim/turn-runner-sequential";
import type { DagTurnRunner } from "../../sim/turn-runner-dag";
import type { SimKindGuard, SimRuntimeStore } from "../../sim/ports";
import type { SimTurnJobPayload } from "../queues";
import { createWorker } from "./helpers";

const logger = createLogger("sim-turn-worker");

export interface SimTurnWorkerDeps {
  store: SimRuntimeStore;
  orchestrator: SimOrchestrator;
  sequentialRunner: SequentialTurnRunner;
  dagRunner: DagTurnRunner;
  kindGuard: SimKindGuard;
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

      const run = await deps.store.getRun(simRunId);

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

      const driver = deps.kindGuard.driverForKind(run.kind);
      if (driver.runner === "sequential") {
        const r = await deps.sequentialRunner.runTurn({ simRunId, turnIndex });
        if (r.terminal) {
          logger.info(
            { simRunId, turnIndex, actionKind: r.action.kind },
            "terminal action — run closed by sequential driver",
          );
          return { terminal: true, simTurnId: r.simTurnId };
        }
      } else {
        await deps.dagRunner.runTurn({ simRunId, turnIndex });
      }

      // Ask orchestrator to schedule the next turn (or close the run).
      const next = await deps.orchestrator.scheduleNext(simRunId);
      return { scheduled: next.scheduled, reason: next.reason };
    },
  });
}

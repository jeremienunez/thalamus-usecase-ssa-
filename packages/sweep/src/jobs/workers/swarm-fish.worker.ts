/**
 * swarm-fish worker — drains the turns of ONE fish inline.
 *
 * Why inline (no per-turn BullMQ round-trip): fish are short (≤20 turns),
 * and the swarm is already fanned out across K parallel BullMQ jobs.
 * Per-turn round-trips would add ~10× latency for no benefit. See
 * SPEC-SW-006 §Turn loop and tasks/sweep-sim-plan.md §4.5c.
 *
 * On failure: if a turn throws repeatedly (JSON validation, LLM error),
 * the fish transitions to sim_run.status='failed' and the swarm counts
 * it against quorum but continues. The exception is re-thrown so BullMQ
 * records the job as failed — but crucially, onFishComplete() is called
 * in a `finally` block so the swarm can still aggregate once quorum is
 * reached.
 */

import type { Worker } from "bullmq";
import { createLogger } from "@interview/shared/observability";
import type { SequentialTurnRunner } from "../../sim/turn-runner-sequential";
import type { DagTurnRunner } from "../../sim/turn-runner-dag";
import type { SimKindGuard, SimRuntimeStore } from "../../sim/ports";
import type { SwarmService, SwarmFishJobPayload } from "../../sim/swarm.service";
import type { SimConfig } from "../../sim/types";
import { createWorker } from "./helpers";

const logger = createLogger("swarm-fish-worker");

export interface SwarmFishWorkerDeps {
  store: SimRuntimeStore;
  swarmService: SwarmService;
  sequentialRunner: SequentialTurnRunner;
  dagRunner: DagTurnRunner;
  kindGuard: SimKindGuard;
  concurrency?: number;
}

export function createSwarmFishWorker(
  deps: SwarmFishWorkerDeps,
): Worker<SwarmFishJobPayload> {
  return createWorker<SwarmFishJobPayload>({
    name: "swarm-fish",
    concurrency: deps.concurrency ?? 8,
    processor: async (job) => {
      const { swarmId, simRunId, fishIndex } = job.data;

      let success = false;
      let failureReason: string | null = null;

      try {
        const run = await deps.store.getRun(simRunId);

        if (!run) throw new Error(`sim_run ${simRunId} not found`);
        if (run.status !== "running") {
          logger.info(
            { swarmId, simRunId, status: run.status },
            "fish not in running state, skipping",
          );
          success = true; // not a failure — someone else closed it
          return { skipped: true };
        }

        const config = run.config as SimConfig;
        const maxTurns = config.maxTurns;

        // Inline turn loop.
        let terminal = false;
        let turnIndex = 0;
        const driver = deps.kindGuard.driverForKind(run.kind);
        while (turnIndex < maxTurns && !terminal) {
          if (driver.runner === "sequential") {
            const r = await deps.sequentialRunner.runTurn({ simRunId, turnIndex });
            terminal = r.terminal;
          } else {
            await deps.dagRunner.runTurn({ simRunId, turnIndex });
            terminal = driver.singleTurn;
          }
          turnIndex++;
        }

        // Close the fish if it ran to maxTurns without a terminal action
        // (sequential with no accept/reject, or DAG always).
        await deps.store.updateRunStatus(simRunId, "done", new Date());

        success = true;
        logger.info(
          { swarmId, simRunId, fishIndex, turnsPlayed: turnIndex, terminal },
          "fish drained",
        );
      } catch (err) {
        failureReason = (err as Error).message;
        logger.error(
          { swarmId, simRunId, fishIndex, err: failureReason },
          "fish failed",
        );
        // Mark the fish as failed so the swarm can still aggregate.
        await deps.store.updateRunStatus(simRunId, "failed", new Date());
      } finally {
        // Always notify the swarm — even on failure — so quorum tracking
        // can progress.
        await deps.swarmService.onFishComplete(swarmId);
      }

      if (!success && failureReason) {
        throw new Error(failureReason);
      }
      return { ok: true };
    },
  });
}

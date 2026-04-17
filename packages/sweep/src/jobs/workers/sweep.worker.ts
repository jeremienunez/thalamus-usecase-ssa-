/**
 * Nano Sweep Worker — weekly DB audit via nano swarm.
 *
 * Plan 1 Task 2.2: takes an injected NanoSweepService instead of
 * constructing one in-process. The container wires it with the right
 * DomainAuditProvider (injected port or legacy fallback).
 */

import type { Worker } from "bullmq";
import type { NanoSweepService } from "../../services/nano-sweep.service";
import { createWorker } from "./helpers";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("worker:sweep");

export function createSweepWorker(
  nanoSweepService: NanoSweepService,
): Worker {
  return createWorker({
    name: "sweep",
    processor: async () => {
      logger.info("Nano sweep starting");
      return nanoSweepService.sweep();
    },
  });
}

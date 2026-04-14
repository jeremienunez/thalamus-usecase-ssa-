/**
 * Nano Sweep Worker — weekly DB audit via nano swarm.
 */

import type { Worker } from "bullmq";
import type { SatelliteRepository } from "../../repositories/satellite.repository";
import type { SweepRepository } from "../../repositories/sweep.repository";
import { createWorker } from "./helpers";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("worker:sweep");

export function createSweepWorker(
  satelliteRepo: SatelliteRepository,
  sweepRepo: SweepRepository,
): Worker {
  let service:
    | import("../../services/nano-sweep.service").NanoSweepService
    | null = null;

  return createWorker({
    name: "sweep",
    processor: async () => {
      if (!service) {
        const { NanoSweepService } =
          await import("../../services/nano-sweep.service");
        service = new NanoSweepService(satelliteRepo, sweepRepo);
        logger.info("Nano sweep service initialized");
      }
      return service.sweep();
    },
  });
}

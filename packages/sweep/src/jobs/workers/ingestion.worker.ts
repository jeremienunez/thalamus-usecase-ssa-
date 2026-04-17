/**
 * Ingestion Worker — dispatches BullMQ jobs on the `ingestion` queue to
 * fetchers in the IngestionRegistry by `job.name`.
 *
 * One worker process per queue; concurrency 1 because most fetchers hit
 * external APIs and we don't want to thrash them. Per-fetcher rate-limit
 * tuning belongs in the fetcher, not here.
 */

import type { Worker } from "bullmq";
import { createWorker } from "./helpers";
import { createLogger } from "@interview/shared/observability";
import type {
  IngestionRegistry,
  IngestionResult,
} from "../ingestion-registry";

const logger = createLogger("worker:ingestion");

export function createIngestionWorker(registry: IngestionRegistry): Worker {
  return createWorker<unknown>({
    name: "ingestion",
    concurrency: 1,
    processor: async (job): Promise<IngestionResult> => {
      const jobName = job.name;
      logger.info({ jobId: job.id, jobName }, "ingestion job started");
      const result = await registry.run(jobName);
      logger.info(
        {
          jobId: job.id,
          jobName,
          inserted: result.inserted,
          skipped: result.skipped,
          notes: result.notes,
        },
        "ingestion job complete",
      );
      return result;
    },
  });
}

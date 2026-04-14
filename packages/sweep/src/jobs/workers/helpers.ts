/**
 * Worker factory — eliminates boilerplate for BullMQ worker creation.
 */

import { Worker, type Job } from "bullmq";
import { redis } from "../../config/redis";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("workers");

export interface WorkerConfig<T = unknown> {
  name: string;
  processor: (job: Job<T>) => Promise<unknown>;
  concurrency?: number;
}

/**
 * Create a BullMQ worker with standard event handlers.
 */
export function createWorker<T = unknown>(config: WorkerConfig<T>): Worker<T> {
  const worker = new Worker<T>(config.name, config.processor, {
    connection: redis,
    concurrency: config.concurrency ?? 1,
  });

  worker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, jobName: job.name },
      `${config.name} job completed`,
    );
  });

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, jobName: job?.name, err: err.message },
      `${config.name} job failed`,
    );
  });

  return worker;
}

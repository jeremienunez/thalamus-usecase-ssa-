/**
 * Cron schedulers — trimmed for standalone extraction.
 * Original registered 10+ crons; this keeps only weekly sweep.
 */

import type { Queue } from "bullmq";
import { sweepQueue } from "./queues";
import { createLogger } from "@interview/shared";

const logger = createLogger("schedulers");

async function schedule(
  queue: Queue,
  name: string,
  cron: string,
  jobName: string,
): Promise<void> {
  await queue.upsertJobScheduler(name, { pattern: cron }, { name: jobName, data: {} });
  logger.info({ name, cron }, "scheduler registered");
}

export async function registerSchedulers(): Promise<void> {
  await schedule(sweepQueue, "weekly-sweep", "0 4 * * 0", "sweep");
}

/**
 * Cron schedulers — trimmed for standalone extraction.
 * Original registered 10+ crons; this keeps only weekly sweep + ingestion.
 *
 * Ingestion crons are added incrementally as Phase 3 fetchers ship. Each
 * Phase 3 ingester registers its scheduler entry here using its stable
 * jobName (matching the IngestionRegistry key).
 */

import type { Queue } from "bullmq";
import { ingestionQueue, sweepQueue } from "./queues";
import { createLogger } from "@interview/shared";

const logger = createLogger("schedulers");

async function schedule(
  queue: Queue,
  name: string,
  cron: string,
  jobName: string,
): Promise<void> {
  await queue.upsertJobScheduler(name, { pattern: cron }, { name: jobName, data: {} });
  logger.info({ name, cron, queue: queue.name, jobName }, "scheduler registered");
}

export async function registerSchedulers(): Promise<void> {
  await schedule(sweepQueue, "weekly-sweep", "0 4 * * 0", "sweep");

  // Ingestion harness probe — runs hourly so a human can confirm the
  // worker + queue + scheduler are all live without waiting for a real
  // Phase 3 fetcher's natural cadence. Real fetchers register alongside.
  await schedule(ingestionQueue, "ingestion-noop", "0 * * * *", "noop");

  // Phase 3a — TLE history snapshot every 6 h. CelesTrak publishes new
  // TLEs multiple times per day per object; 6 h matches their cadence
  // without hammering their per-group feeds.
  await schedule(
    ingestionQueue,
    "ingestion-tle-history",
    "0 */6 * * *",
    "tle-history",
  );

  // Phase 3b — Space weather daily at 04:30 UTC. NOAA publishes the
  // 27-day outlook once per day around 00:00 UTC; GFZ + SIDC update on
  // similar cadences. One fetch per day keeps us current without waste.
  await schedule(
    ingestionQueue,
    "ingestion-space-weather",
    "30 4 * * *",
    "space-weather",
  );

  // Phase 3c — Launch manifest every 12 h. LL2 ingests from upstream
  // providers (SpaceX, ULA, Roscosmos, CNSA, ISRO...) at roughly daily
  // cadence; 12 h gives a fresh window for T-minus precision changes
  // without thrashing the API.
  await schedule(
    ingestionQueue,
    "ingestion-launch-manifest",
    "0 */12 * * *",
    "launch-manifest",
  );

  // Phase 3d — NOTAMs / TFRs every 6 h. FAA publishes new TFRs on
  // demand; 6 h catches launch-window shifts without hammering the API.
  await schedule(
    ingestionQueue,
    "ingestion-notams",
    "15 */6 * * *",
    "notams",
  );
}

/**
 * BullMQ Queue Definitions — trimmed for standalone extraction.
 * Original file defined 10+ queues; this keeps only sweep.
 */

import { Queue, QueueEvents } from "bullmq";
import { redis } from "../config/redis";
import { createLogger } from "@interview/shared";

const logger = createLogger("queues");

export const sweepQueue = new Queue("sweep", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 200 },
  },
});

/**
 * Satellite enrichment queue — consumed by sweep-resolution.service
 * when an `enrich` resolution action is executed. Kept as a dedicated
 * queue to isolate enrichment back-pressure from the main sweep queue.
 */
export const satelliteQueue = new Queue("satellite", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 200 },
  },
});

/**
 * Sim-turn queue — one job = one turn of one sim_run.
 *
 * Used by the standalone orchestrator (admin UI, live UC1 with god-inject).
 * Swarm fish do NOT use this queue — they drain turns inline inside their
 * own worker for ~10× speedup on short fish. See SPEC-SW-006 §Turn loop.
 */
export interface SimTurnJobPayload {
  simRunId: number;
  turnIndex: number;
}

export const simTurnQueue = new Queue<SimTurnJobPayload>("sim-turn", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});

/**
 * Swarm fan-out queues — one job per fish, one job per swarm aggregate.
 */
export interface SwarmFishJobPayloadWire {
  swarmId: number;
  simRunId: number;
  fishIndex: number;
}
export interface SwarmAggregateJobPayloadWire {
  swarmId: number;
}

export const swarmFishQueue = new Queue<SwarmFishJobPayloadWire>("swarm-fish", {
  connection: redis,
  defaultJobOptions: {
    attempts: 1, // fish failures are captured in sim_run.status; BullMQ retry would re-drain turns
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});

export const swarmAggregateQueue = new Queue<SwarmAggregateJobPayloadWire>(
  "swarm-aggregate",
  {
    connection: redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  },
);

/**
 * Ingestion queue — periodic + on-demand structured-data fetchers
 * (TLE history, solar weather, launch manifest, NOTAMs, ITU filings,
 * fragmentation events). Job `name` selects the fetcher in the
 * ingestion registry; data payload is fetcher-specific.
 */
export const ingestionQueue = new Queue("ingestion", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
});

export const sweepQueueEvents = new QueueEvents("sweep", { connection: redis });
export const simTurnQueueEvents = new QueueEvents("sim-turn", { connection: redis });
export const swarmFishQueueEvents = new QueueEvents("swarm-fish", { connection: redis });
export const swarmAggregateQueueEvents = new QueueEvents("swarm-aggregate", {
  connection: redis,
});
export const ingestionQueueEvents = new QueueEvents("ingestion", {
  connection: redis,
});

sweepQueueEvents.on("completed", ({ jobId }) => {
  logger.info({ jobId }, "sweep job completed");
});

sweepQueueEvents.on("failed", ({ jobId, failedReason }) => {
  logger.error({ jobId, failedReason }, "sweep job failed");
});

export async function closeQueues(): Promise<void> {
  await Promise.all([
    sweepQueue.close(),
    satelliteQueue.close(),
    simTurnQueue.close(),
    swarmFishQueue.close(),
    swarmAggregateQueue.close(),
    ingestionQueue.close(),
    sweepQueueEvents.close(),
    simTurnQueueEvents.close(),
    swarmFishQueueEvents.close(),
    swarmAggregateQueueEvents.close(),
    ingestionQueueEvents.close(),
  ]);
}

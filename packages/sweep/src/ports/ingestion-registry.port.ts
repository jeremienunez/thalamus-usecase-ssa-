/**
 * IngestionSourceProvider — engine → pack.
 *
 * The pack registers its ingestion fetchers with the engine at boot.
 * Each fetcher becomes a BullMQ job kind; the IngestionRegistry (engine)
 * dispatches by name.
 *
 * Fetchers receive a context assembled by the engine: db + structured logger
 * (+ optional redis, + optional abort signal). Matches what the current
 * SSA fetchers (tle-history, itu-filings, launch-manifest, fragmentation-events,
 * notam, space-weather) consume; redis is reserved for future sources.
 */

import type { Database } from "@interview/db-schema";
import type IORedis from "ioredis";

export interface IngestionRunContext {
  db: Database;
  /** Optional for future sources; current fetchers only require db + logger. */
  redis?: IORedis;
  logger: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
  signal?: AbortSignal;
}

export interface IngestionSource<TResult = unknown> {
  /**
   * Unique id used as BullMQ job name, scheduler key, and
   * IngestionRegistry.has/dispatch lookup key.
   */
  id: string;
  description?: string;
  /**
   * Optional cron expression. When present, schedulers.ts auto-registers
   * a BullMQ repeat job for this source.
   */
  cron?: string;
  run(ctx: IngestionRunContext): Promise<TResult>;
}

export interface IngestionRegisterContext {
  add(source: IngestionSource): void;
}

export interface IngestionSourceProvider {
  register(ctx: IngestionRegisterContext): void;
}

/**
 * Ingestion fetcher registry — `jobName → fetcher fn` map consumed by the
 * ingestion worker. Each Phase 3 ingester (TLE history, solar weather,
 * launch manifest, NOTAMs, fragmentation events, ITU filings) lives in
 * `./ingesters/` and registers itself here with a stable jobName that
 * matches its scheduler entry.
 *
 * Built once at container boot via `createIngestionRegistry(deps)` so
 * fetchers receive shared infra (db handle, logger, redis) without each
 * having to know about composition root.
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import { createLogger, type Logger } from "@interview/shared/observability";

export interface IngestionContext {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
  jobName: string;
}

export interface IngestionResult {
  /** Rows inserted / upserted by this run. */
  inserted: number;
  /** Rows skipped (already present, out of horizon, etc.). */
  skipped: number;
  /** Free-form notes for ops surfaced via job return value. */
  notes?: string;
}

export type IngestionFetcher = (ctx: IngestionContext) => Promise<IngestionResult>;

export interface IngestionRegistryDeps {
  db: NodePgDatabase<typeof schema>;
  /** Optional — defaults to `createLogger("ingestion")` so callers don't
   *  have to thread Fastify's logger through (which has a different shape). */
  logger?: Logger;
}

export class IngestionRegistry {
  private fetchers = new Map<string, IngestionFetcher>();
  private readonly logger: Logger;
  private readonly db: NodePgDatabase<typeof schema>;

  constructor(deps: IngestionRegistryDeps) {
    this.db = deps.db;
    this.logger = deps.logger ?? createLogger("ingestion");
  }

  register(jobName: string, fetcher: IngestionFetcher): void {
    if (this.fetchers.has(jobName)) {
      throw new Error(`Ingestion fetcher "${jobName}" already registered`);
    }
    this.fetchers.set(jobName, fetcher);
  }

  has(jobName: string): boolean {
    return this.fetchers.has(jobName);
  }

  names(): string[] {
    return [...this.fetchers.keys()];
  }

  async run(jobName: string): Promise<IngestionResult> {
    const fetcher = this.fetchers.get(jobName);
    if (!fetcher) {
      throw new Error(
        `No ingestion fetcher registered for job "${jobName}". ` +
          `Known: ${this.names().join(", ") || "(none)"}`,
      );
    }
    return fetcher({
      db: this.db,
      logger: this.logger.child({ ingestionJob: jobName }),
      jobName,
    });
  }
}

/**
 * Build the registry and install the baseline `noop` fetcher used by the
 * harness e2e test (`POST /api/ingestion/run/noop`). Phase 3 fetchers are
 * appended here as they're written.
 */
export function createIngestionRegistry(
  deps: IngestionRegistryDeps,
): IngestionRegistry {
  const registry = new IngestionRegistry(deps);

  registry.register("noop", async (ctx) => {
    ctx.logger.info("noop ingestion job ran");
    return { inserted: 0, skipped: 0, notes: "noop harness probe" };
  });

  // Phase 3a — TLE history time-series (CelesTrak every 6 h).
  // Dynamic import keeps the registry module free of heavy fetcher deps
  // at import time (HTTP timers, potentially schema-dependent imports).
  registry.register("tle-history", async (ctx) => {
    const { tleHistoryFetcher } = await import(
      "./ingesters/tle-history-fetcher"
    );
    return tleHistoryFetcher(ctx);
  });

  // Phase 3b — Space weather forecast / nowcast (daily).
  // Three sources: NOAA SWPC (US), GFZ Potsdam (DE), SIDC/STCE (BE).
  registry.register("space-weather", async (ctx) => {
    const { spaceWeatherFetcher } = await import(
      "./ingesters/space-weather-fetcher"
    );
    return spaceWeatherFetcher(ctx);
  });

  // Phase 3c — Launch manifest enrichment (every 12 h).
  // Pulls upcoming launches from Launch Library 2 (worldwide aggregator).
  registry.register("launch-manifest", async (ctx) => {
    const { launchManifestFetcher } = await import(
      "./ingesters/launch-manifest-fetcher"
    );
    return launchManifestFetcher(ctx);
  });

  // Phase 3d — NOTAM / TFR (every 6 h).
  // FAA Temporary Flight Restrictions — `SPACE OPERATIONS` type flags
  // launch hazard areas that `launch_scout` uses to confirm pad+vehicle
  // pairings.
  registry.register("notams", async (ctx) => {
    const { notamFetcher } = await import("./ingesters/notam-fetcher");
    return notamFetcher(ctx);
  });

  // Phase 3e — Fragmentation events curated seed.
  // Not on a cron; triggered manually when the event list changes (~1-2
  // new breakups/year). Idempotent upsert by (parent_name, date_utc).
  registry.register("fragmentation-events", async (ctx) => {
    const { fragmentationEventsFetcher } = await import(
      "./ingesters/fragmentation-events-fetcher"
    );
    return fragmentationEventsFetcher(ctx);
  });

  // Phase 3f — ITU filings curated seed.
  // No live scrape: ITU's public SNL/SRS endpoints are HTML-only ASP
  // pages with no JSON API; SRS web service was shut down in 2021.
  // Curated seed focuses on mega-constellation filings that matter
  // for launch_scout — rare additions, manual refresh.
  registry.register("itu-filings", async (ctx) => {
    const { ituFilingsFetcher } = await import(
      "./ingesters/itu-filings-fetcher"
    );
    return ituFilingsFetcher(ctx);
  });

  return registry;
}

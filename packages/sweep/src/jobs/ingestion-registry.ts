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
 * harness e2e test (`POST /api/ingestion/run/noop`).
 *
 * Plan 1 Task 1.7 moved the 6 SSA fetchers (tle-history, space-weather,
 * launch-manifest, notams, fragmentation-events, itu-filings) to
 * `apps/console-api/src/agent/ssa/sweep/ingesters/`. Task 2.4 will add a
 * `providers[]` field on this registry's deps so that pack can register
 * them via `IngestionSourceProvider`. Between Task 1.7 and Task 3.1
 * (console-api wiring), scheduled SSA ingestion jobs fail with "no
 * fetcher registered" — live ingestion is temporarily paused during the
 * refactor window.
 */
export function createIngestionRegistry(
  deps: IngestionRegistryDeps,
): IngestionRegistry {
  const registry = new IngestionRegistry(deps);

  registry.register("noop", async (ctx) => {
    ctx.logger.info("noop ingestion job ran");
    return { inserted: 0, skipped: 0, notes: "noop harness probe" };
  });

  return registry;
}

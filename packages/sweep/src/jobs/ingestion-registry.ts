/**
 * Ingestion fetcher registry — `jobName → fetcher fn` map consumed by the
 * ingestion worker. Each ingest source is contributed by an
 * IngestionSourceProvider at boot — the provider is constructed with its own
 * DB/Redis handles inside the app pack, so the kernel registry carries zero
 * persistence knowledge.
 */

import { createLogger, type Logger } from "@interview/shared/observability";
import type { IngestionSourceProvider } from "../ports";

export interface IngestionContext {
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
  /** Optional — defaults to `createLogger("ingestion")` so callers don't
   *  have to thread Fastify's logger through (which has a different shape). */
  logger?: Logger;
  /**
   * Domain ingestion providers. Each provider.register() hooks its sources
   * into the registry via the `IngestionSource.run` adapter installed below.
   */
  providers?: IngestionSourceProvider[];
}

export class IngestionRegistry {
  private fetchers = new Map<string, IngestionFetcher>();
  private readonly logger: Logger;

  constructor(deps: IngestionRegistryDeps) {
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
      logger: this.logger.child({ ingestionJob: jobName }),
      jobName,
    });
  }
}

/**
 * Build the registry and install the baseline `noop` fetcher used by the
 * harness e2e test (`POST /api/ingestion/run/noop`). Providers registered
 * via `deps.providers` contribute their own sources — constructed with
 * the caller's persistence handles, never with engine-side ones.
 */
export function createIngestionRegistry(
  deps: IngestionRegistryDeps,
): IngestionRegistry {
  const registry = new IngestionRegistry(deps);

  registry.register("noop", async (ctx) => {
    ctx.logger.info("noop ingestion job ran");
    return { inserted: 0, skipped: 0, notes: "noop harness probe" };
  });

  for (const provider of deps.providers ?? []) {
    provider.register({
      add: (source) => {
        registry.register(source.id, async (legacyCtx) => {
          const result = await source.run({ logger: legacyCtx.logger });
          // Legacy contract returns IngestionResult; sources wrap themselves
          // with that shape. Cast narrows the generic TResult.
          return result as IngestionResult;
        });
      },
    });
  }

  return registry;
}

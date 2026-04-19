import { createLogger } from "@interview/shared/observability";
import type { SourceResult, SourceFetcher, SourceKind } from "./types";

const logger = createLogger("source-registry");

/**
 * Cortex-name → fetchers. Populated at module-load via `registerSource()`
 * called from each fetcher file (self-registration pattern).
 */
const CORTEX_SOURCE_MAP: Record<string, SourceFetcher[]> = {};

/**
 * SSA source-key → fetcher. Keeps a second index so planners and skills
 * can address a specific source by a stable identifier rather than by
 * the cortex name it attaches to.
 */
const SOURCE_KIND_MAP: Partial<Record<SourceKind, SourceFetcher>> = {};

const CACHE = new Map<string, { results: SourceResult[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function registerSource(
  cortices: string[],
  fetcher: SourceFetcher,
  kind?: SourceKind,
): void {
  for (const cortex of cortices) {
    if (!CORTEX_SOURCE_MAP[cortex]) CORTEX_SOURCE_MAP[cortex] = [];
    CORTEX_SOURCE_MAP[cortex].push(fetcher);
  }
  if (kind) SOURCE_KIND_MAP[kind] = fetcher;
}

export function getFetcherByKind(kind: SourceKind): SourceFetcher | undefined {
  return SOURCE_KIND_MAP[kind];
}

export async function fetchSourcesForCortex(
  cortexName: string,
  params: Record<string, unknown>,
): Promise<SourceResult[]> {
  const fetchers = CORTEX_SOURCE_MAP[cortexName];
  if (!fetchers || fetchers.length === 0) return [];

  // JSON.stringify throws on bigint — params sometimes carry bigint ids
  // (operatorId, noradId) passed through from DB repos. Coerce bigint to
  // string so the cache key is stable AND the stringify doesn't blow up.
  const cacheKey = `${cortexName}:${JSON.stringify(params, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  )}`;
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    logger.debug(
      { cortex: cortexName, cached: cached.results.length },
      "Source cache hit",
    );
    return cached.results;
  }

  const results = await Promise.allSettled(fetchers.map((fn) => fn(params)));

  const allResults: SourceResult[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      allResults.push(...r.value);
    } else {
      logger.debug(
        { cortex: cortexName, error: r.reason },
        "Source fetcher failed (non-blocking)",
      );
    }
  }

  CACHE.set(cacheKey, {
    results: allResults,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  logger.info(
    { cortex: cortexName, sources: allResults.length },
    "External sources fetched",
  );
  return allResults;
}

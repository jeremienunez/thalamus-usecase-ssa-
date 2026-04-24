import type {
  SourceFetcherPort,
  SourceResult,
} from "../ports/source-fetcher.port";

/**
 * Default `SourceFetcherPort` for kernel builds without a domain adapter.
 * Always returns an empty array — `StandardStrategy` then falls through
 * to SQL + web-search-only execution. SSA (and other domains) replace
 * this with an adapter wrapping their own fetcher registry.
 */
export class NoopSourceFetcher implements SourceFetcherPort {
  async fetchForCortex(
    _cortexName: string,
    _params: Record<string, unknown>,
    _options?: { signal?: AbortSignal },
  ): Promise<SourceResult[]> {
    return [];
  }
}

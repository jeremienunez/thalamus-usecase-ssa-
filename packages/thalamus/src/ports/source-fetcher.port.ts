/**
 * SourceFetcherPort — domain-owned external-data aggregator.
 *
 * `StandardStrategy` calls this port once per cortex activation to pull
 * structured rows from HTTP sources (RSS feeds, catalogs, advisories…).
 * The kernel stays ignorant of which sources exist for which cortex —
 * domains ship their own registry behind the port.
 */

export interface SourceResult {
  /** Arbitrary row-type tag used by pre-summarize logic. */
  type: string;
  /** Stable source identifier (e.g. "celestrak", "spectra"). */
  source: string;
  /** Canonical URL of the upstream record, when known. */
  url?: string;
  /** Raw row payload. Shape is domain-specific. */
  data: unknown;
  /** ISO timestamp of when the fetch completed. */
  fetchedAt: string;
  /** Wall-clock fetch latency in ms. */
  latencyMs: number;
}

export interface SourceFetcherPort {
  /**
   * Fetch all source results for a given cortex. `params` are the skill
   * params passed by the planner; the adapter routes them to the right
   * upstream fetchers. Returns empty array when no source is configured
   * for the cortex.
   */
  fetchForCortex(
    cortexName: string,
    params: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<SourceResult[]>;
}

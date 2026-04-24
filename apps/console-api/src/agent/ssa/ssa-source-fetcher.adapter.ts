/**
 * SSA SourceFetcherPort adapter.
 *
 * Wraps the SSA fetcher registry (local to the app since Task 3.3c).
 * Kernel stays ignorant of celestrak / spectra / rss / arxiv / etc.
 */

import { fetchSourcesForCortex } from "./sources";
import type { SourceFetcherPort, SourceResult } from "@interview/thalamus";

export class SsaSourceFetcherAdapter implements SourceFetcherPort {
  async fetchForCortex(
    cortexName: string,
    params: Record<string, unknown>,
    _options?: { signal?: AbortSignal },
  ): Promise<SourceResult[]> {
    return fetchSourcesForCortex(cortexName, params);
  }
}

/**
 * SSA SourceFetcherPort adapter.
 *
 * Wraps the SSA fetcher registry so the thalamus kernel stays free of
 * direct `fetchSourcesForCortex` coupling. During Task 3.3b the registry
 * still lives inside the kernel package; we import it via the temporary
 * barrel bridge. Task 3.3c moves the registry here and updates this
 * import.
 */

import {
  fetchSourcesForCortex,
  type SourceFetcherPort,
  type SourceResult,
} from "@interview/thalamus";

export class SsaSourceFetcherAdapter implements SourceFetcherPort {
  async fetchForCortex(
    cortexName: string,
    params: Record<string, unknown>,
  ): Promise<SourceResult[]> {
    return fetchSourcesForCortex(cortexName, params);
  }
}

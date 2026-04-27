/**
 * Port: data provider injected by the app.
 *
 * A named function that the cortex executor calls to fetch domain data.
 * The executor passes the skill's params; the app wraps a repo/service call.
 * No Database, no SQL, no domain knowledge in the kernel.
 */

export type DataProviderFn = (
  params: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<unknown[]>;

/**
 * Map of sqlHelper names (from skill frontmatter) → data-fetcher functions.
 * Built by the app's composition root, injected into CortexExecutor.
 */
export type CortexDataProvider = Record<string, DataProviderFn>;

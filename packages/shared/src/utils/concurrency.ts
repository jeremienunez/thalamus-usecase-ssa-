/**
 * Concurrency helpers.
 *
 * Preserves input order (result[i] matches items[i]) and propagates the
 * first rejection unless the caller caps errors inside the mapper. No
 * timers, no allocations per task beyond the result slot.
 */

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`mapWithConcurrency: limit must be >= 1 (got ${limit})`);
  }
  if (items.length === 0) return [];
  const cap = Math.min(limit, items.length);
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  };

  await Promise.all(Array.from({ length: cap }, () => worker()));
  return results;
}

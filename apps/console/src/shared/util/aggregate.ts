/**
 * Count items by a key function. Returns a Map so callers can ask for
 * totals, maxima, or slice the top-N.
 */
export function countBy<T, K>(items: readonly T[], keyFn: (item: T) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const item of items) {
    const k = keyFn(item);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/**
 * Top-N entries of a count map, sorted descending by count. Returns
 * [key, count] tuples.
 */
export function topN<K>(counts: Map<K, number>, n: number): Array<[K, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Convenience: max count value in a count map (0 for empty maps). */
export function maxCount<K>(counts: Map<K, number>): number {
  let max = 0;
  for (const v of counts.values()) if (v > max) max = v;
  return max;
}

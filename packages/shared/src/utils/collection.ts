/**
 * Collection Utilities - Array and string operations
 * Cross-cutting concern: used in both server and agent layers.
 *
 * Reusable patterns for:
 * - String normalization (case-insensitive, diacritics-free)
 * - Array sliding windows (keepLastN)
 * - Case-insensitive array operations
 * - Generic deduplication
 */

import { removeDiacritics } from "./string";

// ============================================================================
// String Normalization
// ============================================================================

/**
 * Basic text normalization: lowercase + trim
 * Use for simple case-insensitive comparisons
 *
 * @example normalize("  Bordeaux  ") // "bordeaux"
 */
export function normalize(text: string): string {
  return text.toLowerCase().trim();
}

/**
 * Full text normalization for search/matching: lowercase + trim + remove diacritics
 * Use for fuzzy matching (e -> e, a -> a, etc.)
 *
 * @example normalizeForSearch("Cotes du Rhone") // "cotes du rhone"
 */
export function normalizeForSearch(text: string): string {
  return removeDiacritics(text.toLowerCase().trim());
}

// ============================================================================
// Array Operations - Keep Last N (Sliding Window)
// ============================================================================

/**
 * Keep only the last N items in an array (sliding window)
 * Returns the same array reference if length <= max (no copy)
 *
 * @example keepLastN([1,2,3,4,5], 3) // [3,4,5]
 * @example keepLastN([1,2], 3) // [1,2] (same reference)
 */
export function keepLastN<T>(array: T[], maxLength: number): T[] {
  if (array.length <= maxLength) return array;
  return array.slice(-maxLength);
}

/**
 * Push item and keep only last N (mutates array)
 * Returns the array for chaining
 *
 * @example pushAndKeepLastN(arr, item, 50)
 */
export function pushAndKeepLastN<T>(
  array: T[],
  item: T,
  maxLength: number,
): T[] {
  array.push(item);
  if (array.length > maxLength) {
    array.splice(0, array.length - maxLength);
  }
  return array;
}

// ============================================================================
// Array Operations - Case-Insensitive (Normalized)
// ============================================================================

/**
 * Check if array includes value (case-insensitive)
 *
 * @example includesNormalized(['Bordeaux', 'Bourgogne'], 'bordeaux') // true
 */
export function includesNormalized(array: string[], value: string): boolean {
  const normalizedValue = normalize(value);
  return array.some((item) => normalize(item) === normalizedValue);
}

/**
 * Check if array includes value (case-insensitive + diacritics removed)
 *
 * @example includesForSearch(['Cotes du Rhone'], 'cotes du rhone') // true
 */
export function includesForSearch(array: string[], value: string): boolean {
  const normalizedValue = normalizeForSearch(value);
  return array.some((item) => normalizeForSearch(item) === normalizedValue);
}

/**
 * Add value to array only if not already present (case-insensitive)
 * Returns true if added, false if already exists
 *
 * @example addUniqueNormalized(arr, 'Bordeaux') // true (added)
 * @example addUniqueNormalized(arr, 'bordeaux') // false (already exists)
 */
export function addUniqueNormalized(array: string[], value: string): boolean {
  if (includesNormalized(array, value)) return false;
  array.push(value);
  return true;
}

/**
 * Find item in array (case-insensitive)
 * Returns the original item from array, or undefined
 *
 * @example findNormalized(['Bordeaux', 'Bourgogne'], 'bordeaux') // 'Bordeaux'
 */
export function findNormalized(
  array: string[],
  value: string,
): string | undefined {
  const normalizedValue = normalize(value);
  return array.find((item) => normalize(item) === normalizedValue);
}

/**
 * Remove item from array (case-insensitive)
 * Returns true if removed, false if not found
 *
 * @example removeNormalized(arr, 'bordeaux') // removes 'Bordeaux' if present
 */
export function removeNormalized(array: string[], value: string): boolean {
  const normalizedValue = normalize(value);
  const index = array.findIndex((item) => normalize(item) === normalizedValue);
  if (index === -1) return false;
  array.splice(index, 1);
  return true;
}

// ============================================================================
// Array Operations - Generic Deduplication
// ============================================================================

/**
 * Deduplicate array using a key function
 * Keeps first occurrence of each unique key
 *
 * @example deduplicateBy(satellites, s => s.id)
 * @example deduplicateBy(strings, s => s.toLowerCase())
 */
export function deduplicateBy<T>(array: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return array.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Deduplicate string array (case-insensitive)
 * Keeps first occurrence with original casing
 *
 * @example deduplicateNormalized(['Bordeaux', 'bordeaux', 'BORDEAUX']) // ['Bordeaux']
 */
export function deduplicateNormalized(array: string[]): string[] {
  return deduplicateBy(array, normalize);
}

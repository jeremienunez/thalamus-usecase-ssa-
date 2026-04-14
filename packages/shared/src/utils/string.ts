/**
 * String Utilities - Truncation, diacritics removal
 * Cross-cutting concern: used in both server and agent layers.
 */

/**
 * Truncate text with optional suffix
 */
export function truncate(
  text: string,
  maxLength: number,
  suffix = "...",
): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Remove diacritics from text (useful for search/matching)
 * Converts accented characters to ASCII equivalents (e -> e, a -> a, etc.)
 */
export function removeDiacritics(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Convert text to URL-safe slug
 * Removes diacritics, lowercases, replaces non-alphanum with hyphens.
 */
export function toSlug(input: string): string {
  return removeDiacritics(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

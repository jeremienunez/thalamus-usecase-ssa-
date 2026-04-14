/**
 * SQL helper utilities
 */

/**
 * Escape special ILIKE/LIKE wildcard characters in user input.
 * Prevents users from injecting `%` or `_` wildcards into search patterns.
 */
export function escapeIlike(input: string): string {
  return input.replace(/[%_\\]/g, (c) => `\\${c}`);
}

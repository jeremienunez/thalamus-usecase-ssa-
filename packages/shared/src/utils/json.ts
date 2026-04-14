/**
 * JSON Utilities - Safe parse/stringify with error handling
 * Cross-cutting concern: used in both server and agent layers.
 */

/**
 * Result type for tryParseJson
 */
export type JsonParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: Error };

/**
 * Safely parse JSON with optional fallback
 * @returns Parsed value, fallback, or null on failure
 */
export function safeJsonParse<T>(json: string, fallback?: T): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback ?? null;
  }
}

/**
 * Safely stringify value with optional fallback
 * @returns JSON string or fallback on failure
 */
export function safeJsonStringify(
  value: unknown,
  fallback: string = "{}",
): string {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

/**
 * Try to parse JSON and return a discriminated result
 * Useful when you need to handle errors explicitly
 */
export function tryParseJson<T>(json: string): JsonParseResult<T> {
  try {
    return { success: true, data: JSON.parse(json) as T };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Async error handling utilities
 */

// Result type - Rust-style error handling
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Async handler with automatic error catching
export async function tryAsync<T>(
  fn: () => Promise<T>,
): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Timeout error with context
 */
export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs: number,
  ) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Wrap a promise with a timeout.
 * Accepts either a Promise<T> directly or a () => Promise<T> factory.
 * Clears the timeout on resolve/reject to prevent timer leaks.
 *
 * @throws TimeoutError if the promise doesn't resolve within timeoutMs
 */
export function withTimeout<T>(
  promiseOrFn: Promise<T> | (() => Promise<T>),
  timeoutMs: number,
  timeoutError?: string,
): Promise<T> {
  const promise =
    typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        new TimeoutError(
          timeoutError ?? `Operation timed out after ${timeoutMs}ms`,
          timeoutMs,
        ),
      );
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Retry options
 */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Delay between attempts in ms (default: 1000) */
  delayMs?: number;
  /** Backoff strategy (default: 'exponential') */
  backoff?: "linear" | "exponential";
  /** Legacy: backoff multiplier for exponential (default: 2). Used when backoff is not specified. */
  backoffMultiplier?: number;
  /** Callback on each retry */
  onRetry?: (attempt: number, error: Error) => void;
  /** Should retry on this error? (default: always retry) */
  shouldRetry?: (error: Error) => boolean;
}

/**
 * Retry a function with configurable backoff
 * @throws Last error if all attempts fail
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoff = "exponential",
    backoffMultiplier = 2,
    onRetry,
    shouldRetry,
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (shouldRetry && !shouldRetry(lastError)) {
        throw lastError;
      }

      if (attempt < maxAttempts) {
        onRetry?.(attempt, lastError);
        const delay =
          backoff === "exponential"
            ? delayMs * Math.pow(backoffMultiplier, attempt - 1)
            : delayMs * attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

// Execute multiple async operations in parallel with error handling
export async function allSettled<T>(
  operations: (() => Promise<T>)[],
): Promise<Result<T, Error>[]> {
  const results = await Promise.allSettled(operations.map((op) => op()));

  return results.map((result) => {
    if (result.status === "fulfilled") {
      return { ok: true, value: result.value };
    } else {
      return {
        ok: false,
        error:
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason)),
      };
    }
  });
}

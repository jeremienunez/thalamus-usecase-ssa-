export function abortError(reason = "Operation aborted"): Error {
  const error = new Error(reason);
  error.name = "AbortError";
  return error;
}

export function abortSignalReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  if (typeof signal.reason === "string") return abortError(signal.reason);
  return abortError();
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortSignalReason(signal);
  }
}

export function isAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError" || /aborted|abort/i.test(message);
}

export async function abortableDelay(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(signal ? abortSignalReason(signal) : abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

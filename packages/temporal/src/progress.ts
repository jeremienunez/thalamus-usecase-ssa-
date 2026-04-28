import type {
  TemporalProgressEvent,
  TemporalProgressReporter,
} from "./types";

export interface TemporalProgressPhaseTracker {
  progress(
    completed: number,
    counters?: TemporalProgressEvent["counters"],
  ): void;
  complete(counters?: TemporalProgressEvent["counters"]): void;
}

export interface StartTemporalProgressPhaseInput {
  phase: string;
  reporter?: TemporalProgressReporter;
  total?: number;
  message?: string;
  min_interval_ms?: number;
  now?: () => number;
}

export function startTemporalProgressPhase(
  input: StartTemporalProgressPhaseInput,
): TemporalProgressPhaseTracker {
  const reporter = input.reporter;
  const total = input.total;
  const now = input.now ?? Date.now;
  const minIntervalMs = input.min_interval_ms ?? 5_000;
  const startedAt = now();
  let lastReportedAt = Number.NEGATIVE_INFINITY;
  let completedValue = 0;

  const emit = (
    status: TemporalProgressEvent["status"],
    completed?: number,
    counters?: TemporalProgressEvent["counters"],
  ): void => {
    if (!reporter) return;
    const currentTime = now();
    const elapsedMs = Math.max(0, currentTime - startedAt);
    const event: TemporalProgressEvent = {
      phase: input.phase,
      status,
      elapsed_ms: elapsedMs,
    };
    if (input.message) event.message = input.message;
    if (total != null) event.total = total;
    if (completed != null) {
      event.completed = completed;
      event.rate_per_sec = ratePerSec(completed, elapsedMs);
      const etaMs = estimateTemporalEtaMs({
        completed,
        total,
        elapsed_ms: elapsedMs,
      });
      if (etaMs != null) event.eta_ms = etaMs;
    }
    if (counters) event.counters = counters;
    reporter(event);
    lastReportedAt = currentTime;
  };

  emit("started", 0);

  return {
    progress(completed, counters) {
      completedValue = completed;
      if (!reporter) return;
      const currentTime = now();
      const isFinished = total != null && completed >= total;
      if (!isFinished && currentTime - lastReportedAt < minIntervalMs) return;
      emit("progress", completed, counters);
    },
    complete(counters) {
      emit("completed", total ?? completedValue, counters);
    },
  };
}

export function estimateTemporalEtaMs(input: {
  completed?: number;
  total?: number;
  elapsed_ms: number;
}): number | null {
  if (
    input.completed == null ||
    input.total == null ||
    input.completed <= 0 ||
    input.total <= input.completed
  ) {
    return null;
  }
  const rate = input.elapsed_ms / input.completed;
  return Math.max(0, Math.round(rate * (input.total - input.completed)));
}

function ratePerSec(completed: number, elapsedMs: number): number | undefined {
  if (completed <= 0 || elapsedMs <= 0) return undefined;
  return Number((completed / (elapsedMs / 1_000)).toFixed(3));
}

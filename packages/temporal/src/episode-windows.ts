import type { TemporalEvent } from "./types";

export interface OutcomeWindow {
  outcome: TemporalEvent;
  preEvents: TemporalEvent[];
}

export function sortTemporalEventsStable(events: TemporalEvent[]): TemporalEvent[] {
  return [...events].sort(
    (left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
}

export function validTemporalEvents(events: TemporalEvent[]): TemporalEvent[] {
  return events.filter((event) => Number.isFinite(event.timestamp));
}

export function buildOutcomeWindows(
  events: TemporalEvent[],
  terminalStatus: string,
  patternWindowMs: number,
): OutcomeWindow[] {
  const ordered = sortTemporalEventsStable(validTemporalEvents(events));
  const windows: OutcomeWindow[] = [];

  for (const outcome of ordered) {
    if (outcome.terminal_status !== terminalStatus) continue;
    const windowStart = outcome.timestamp - patternWindowMs;
    const preEvents = ordered.filter(
      (event) =>
        event.timestamp >= windowStart &&
        event.timestamp < outcome.timestamp &&
        event.id !== outcome.id,
    );
    windows.push({ outcome, preEvents });
  }

  return windows;
}

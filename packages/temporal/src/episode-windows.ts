import type {
  TemporalEvent,
  TemporalEventSet,
  TemporalOrderQuality,
} from "./types";

export interface OutcomeWindow {
  outcome: TemporalEvent;
  preEvents: TemporalEvent[];
}

export function sortTemporalEventsStable(events: TemporalEvent[]): TemporalEvent[] {
  return [...events].sort(
    (left, right) =>
      left.timestamp - right.timestamp ||
      normalizedOrderIndex(left) - normalizedOrderIndex(right) ||
      left.id.localeCompare(right.id),
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

export function buildTemporalEventSets(events: TemporalEvent[]): TemporalEventSet[] {
  const ordered = sortTemporalEventsStable(validTemporalEvents(events));
  const groups = new Map<number, TemporalEvent[]>();
  for (const event of ordered) {
    const bucket = groups.get(event.timestamp) ?? [];
    bucket.push(event);
    groups.set(event.timestamp, bucket);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([timestamp, bucket], index) => ({
      timestamp,
      order_index: index,
      temporal_order_quality: eventSetOrderQuality(bucket),
      events: bucket,
    }));
}

export function temporalOrderQualityForEvents(
  events: TemporalEvent[],
): TemporalOrderQuality {
  if (events.length === 0) return "real_time_ordered";
  const explicit = events.map(eventTemporalOrderQuality);
  if (explicit.includes("synthetic_ordered")) return "synthetic_ordered";
  if (explicit.includes("same_timestamp_ordered")) return "same_timestamp_ordered";

  const ordered = sortTemporalEventsStable(events);
  if (ordered.some((event) => event.temporal_order_quality === "synthetic_ordered")) {
    return "synthetic_ordered";
  }
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.timestamp === ordered[index - 1]!.timestamp) {
      return "same_timestamp_ordered";
    }
  }
  if (explicit.includes("turn_ordered")) return "turn_ordered";
  if (
    ordered.some(
      (event) => event.turn_index != null || event.fish_index != null || event.order_index != null,
    )
  ) {
    return "turn_ordered";
  }
  return "real_time_ordered";
}

function eventSetOrderQuality(events: TemporalEvent[]): TemporalOrderQuality {
  const explicit = events.map(eventTemporalOrderQuality);
  if (explicit.includes("synthetic_ordered")) return "synthetic_ordered";
  if (events.length > 1) return "same_timestamp_ordered";
  if (explicit.includes("turn_ordered")) return "turn_ordered";
  return explicit[0] ?? "real_time_ordered";
}

function eventTemporalOrderQuality(event: TemporalEvent): TemporalOrderQuality {
  if (event.temporal_order_quality) return event.temporal_order_quality;
  const fromMetadata = event.metadata?.temporal_order_quality;
  if (isTemporalOrderQuality(fromMetadata)) return fromMetadata;
  if (event.order_index != null || event.turn_index != null || event.fish_index != null) {
    return "turn_ordered";
  }
  return "real_time_ordered";
}

function isTemporalOrderQuality(value: unknown): value is TemporalOrderQuality {
  return (
    value === "real_time_ordered" ||
    value === "turn_ordered" ||
    value === "same_timestamp_ordered" ||
    value === "synthetic_ordered"
  );
}

function normalizedOrderIndex(event: TemporalEvent): number {
  return Number.isFinite(event.order_index) ? event.order_index! : 0;
}

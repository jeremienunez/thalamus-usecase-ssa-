import { preEventSignature } from "./event-signature";
import { sortTemporalEventsStable } from "./episode-windows";
import type { TemporalEvent } from "./types";

export interface OrderedEpisodeMatchOptions {
  max_span_ms?: number;
  max_gap_ms?: number;
}

export function containsOrderedEpisode(
  events: TemporalEvent[],
  episodeSignatures: string[],
  options: OrderedEpisodeMatchOptions = {},
): boolean {
  if (episodeSignatures.length === 0) return false;
  const ordered = sortTemporalEventsStable(events).filter(
    (event) => event.terminal_status == null,
  );
  const maxSpanMs = options.max_span_ms ?? Number.POSITIVE_INFINITY;
  const maxGapMs = options.max_gap_ms ?? Number.POSITIVE_INFINITY;

  for (let startIndex = 0; startIndex < ordered.length; startIndex += 1) {
    if (preEventSignature(ordered[startIndex]!) !== episodeSignatures[0]) {
      continue;
    }
    let cursor = 1;
    let previous = ordered[startIndex]!;
    for (
      let eventIndex = startIndex + 1;
      eventIndex < ordered.length && cursor < episodeSignatures.length;
      eventIndex += 1
    ) {
      const event = ordered[eventIndex]!;
      if (event.timestamp - ordered[startIndex]!.timestamp > maxSpanMs) break;
      if (event.timestamp - previous.timestamp > maxGapMs) break;
      if (preEventSignature(event) !== episodeSignatures[cursor]) continue;
      previous = event;
      cursor += 1;
    }
    if (cursor === episodeSignatures.length) return true;
  }

  return false;
}

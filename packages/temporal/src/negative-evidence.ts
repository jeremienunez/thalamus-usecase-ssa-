import { canonicalEventSignature } from "./event-signature";
import { sortTemporalEventsStable } from "./episode-windows";
import type { TemporalEvent } from "./types";

export function containsOrderedEpisode(
  events: TemporalEvent[],
  episodeSignatures: string[],
): boolean {
  if (episodeSignatures.length === 0) return false;
  const ordered = sortTemporalEventsStable(events);
  let cursor = 0;

  for (const event of ordered) {
    if (canonicalEventSignature(event) === episodeSignatures[cursor]) {
      cursor += 1;
      if (cursor === episodeSignatures.length) return true;
    }
  }

  return false;
}

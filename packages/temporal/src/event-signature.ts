import { createHash } from "node:crypto";
import type { TemporalEvent } from "./types";

export const DEFAULT_PROJECTION_VERSION = "temporal-projection-v0.2.0";

export function canonicalEventSignature(event: TemporalEvent): string {
  return [
    event.event_type,
    event.event_source,
    event.action_kind ?? "none",
    event.terminal_status ?? "none",
  ].join("|");
}

export function canonicalTemporalEventId(
  event: Pick<TemporalEvent, "source_table" | "source_pk" | "event_type">,
  projectionVersion = DEFAULT_PROJECTION_VERSION,
): string {
  return createHash("sha256")
    .update(
      stableJoin([
        projectionVersion,
        event.source_table,
        event.source_pk,
        event.event_type,
      ]),
    )
    .digest("hex");
}

function stableJoin(parts: string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

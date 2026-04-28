import { createHash } from "node:crypto";
import type { TemporalEvent } from "./types";

export const DEFAULT_PROJECTION_VERSION = "temporal-projection-v0.2.0";

const TARGET_PROXY_EVENT_PATTERNS = [
  /\brisk_high\b/i,
  /\bmax_risk_high\b/i,
  /\brisk_increase(?:d)?\b/i,
  /\bpc_estimate_above_threshold\b/i,
  /\bterminal_status\b/i,
  /\boutcome_/i,
  /\breview_outcome\b/i,
  /\bpromotion_outcome\b/i,
];

export function canonicalEventSignature(event: TemporalEvent): string {
  return [
    event.event_type,
    event.event_source,
    event.action_kind ?? "none",
    event.terminal_status ?? "none",
  ].join("|");
}

export function preEventSignature(event: TemporalEvent): string {
  return [
    event.event_type,
    event.event_source,
    event.action_kind ?? "none",
    "none",
  ].join("|");
}

export function outcomeLabel(event: TemporalEvent): string | null {
  return event.terminal_status ?? null;
}

export function signatureContainsTargetProxy(signature: string): boolean {
  return TARGET_PROXY_EVENT_PATTERNS.some((pattern) => pattern.test(signature));
}

export function eventContainsTargetProxy(event: TemporalEvent): boolean {
  if (event.terminal_status != null) return true;
  if (event.review_outcome != null) return true;
  return signatureContainsTargetProxy(preEventSignature(event));
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

export type EntityKind = "satellite" | "operator" | "finding" | "conjunction" | "unknown";

const PREFIX_MAP: Array<[string, EntityKind]> = [
  ["sat:", "satellite"],
  ["op:", "operator"],
  ["finding:", "finding"],
  ["conj:", "conjunction"],
];

/**
 * Single source of truth for entity-id prefix classification. Replaces the
 * duplicated `switch` patterns in ThalamusMode/FindingReadout/etc.
 */
export function entityKind(id: string): EntityKind {
  for (const [prefix, kind] of PREFIX_MAP) {
    if (id.startsWith(prefix)) return kind;
  }
  return "unknown";
}

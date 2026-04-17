/**
 * Doctrine parsing utilities
 *
 * Extracts structured data from operator-country doctrine JSONB
 * (licence/sharing policy). Business logic (what to parse, how to interpret)
 * lives here, not in repositories.
 */

// ============================================================================
// Types
// ============================================================================

export interface DoctrinePayload {
  name: string;
  role?: string;
  min_pct?: number;
  max_pct?: number;
}

export interface CorrectionEntry {
  from: string | null;
  to: string;
  date: string;
  reason: string;
}

// ============================================================================
// Doctrine Payload Partition Parser
// ============================================================================

/**
 * Parse doctrine payload allocations from raw JSONB.
 * Doctrine stores payloads under `payloads.eo`, `.sar`, `.comm` arrays
 * (platform-class partitions).
 */
export function parseDoctrinePayloads(
  doctrine: Record<string, unknown> | null | undefined,
): DoctrinePayload[] {
  if (!doctrine) return [];

  const payloads = doctrine.payloads as Record<string, unknown[]> | undefined;
  if (!payloads) return [];

  const out: DoctrinePayload[] = [];
  for (const partitionKey of ["eo", "sar", "comm"]) {
    const entries = payloads[partitionKey] as
      | Array<{
          name?: string;
          role?: string;
          min_pct?: number;
          max_pct?: number;
        }>
      | undefined;
    if (entries) {
      for (const p of entries) {
        if (p.name) {
          out.push({
            name: p.name,
            role: p.role,
            min_pct: p.min_pct,
            max_pct: p.max_pct,
          });
        }
      }
    }
  }

  return out;
}

// ============================================================================
// Hierarchy Detection
// ============================================================================

/** Regex pattern for tier hierarchy detection in satellite names (flagship / block II / gen-2). */
export const TIER_HIERARCHY_PATTERN =
  "flagship|block\\s+ii|block\\s+iii|gen[-\\s]?2|gen[-\\s]?3";

// ============================================================================
// Correction History
// ============================================================================

/** Build a correction history entry for operator-country changes */
export function buildCorrectionEntry(
  newOperatorCountryId: bigint,
  reason: string,
): CorrectionEntry {
  return {
    from: null,
    to: newOperatorCountryId.toString(),
    date: new Date().toISOString(),
    reason,
  };
}

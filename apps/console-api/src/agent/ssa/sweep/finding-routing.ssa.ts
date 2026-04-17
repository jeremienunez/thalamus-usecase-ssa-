/**
 * SSA finding-routing — lifted from packages/sweep/src/services/finding-routing.ts.
 *
 * Cortex → tier map + source kind tier resolution. Implements
 * FindingRoutingPolicy port; the generic FindingRouterService (created in
 * Task 2.5) consumes this behind the port.
 *
 * The tier taxonomy ("investment", "enthusiast", "franchise", ...) is SSA-
 * specific — other domains will supply their own map.
 */

import type { FindingRoutingPolicy, FindingTier, FindingSource } from "@interview/sweep";

// ── Cortex → Tier ──

const CORTEX_TIER_MAP: Record<string, string[]> = {
  // Investment-tier cortices
  strategist: ["investment"],
  fleet_analyst: ["investment"],
  launch_scout: ["investment"],
  debris_forecaster: ["investment"],
  advisory_radar: ["investment"],

  // Shared cortices (investment + franchise + enthusiast)
  apogee_tracker: ["investment", "enthusiast", "franchise"],
  payload_profiler: ["franchise"],
  regime_profiler: ["franchise"],

  // Content production — admin only (briefings go through reviewer approval)
  briefing_producer: [],

  // Admin-only cortices (not in map — admin gets all via separate path)
  data_auditor: [],
  classification_auditor: [],
};

export class SsaFindingRoutingPolicy implements FindingRoutingPolicy {
  tiersForSource(source: FindingSource): FindingTier[] {
    if (source.kind === "cortex") {
      return CORTEX_TIER_MAP[source.name] ?? [];
    }
    if (source.kind === "sweep" || source.kind === "research-cycle") {
      return []; // admin only — admin receives via a separate recipient path
    }
    if (source.kind === "consumption") {
      return ["investment", "enthusiast", "franchise"]; // all paid tiers
    }
    return [];
  }
}

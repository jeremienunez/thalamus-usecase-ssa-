/**
 * SSA cortex classifications — which cortices need userId, which need web,
 * which require domain-relevance filtering on their payload.
 *
 * Consumed by the kernel via DomainConfig. Names match the skill frontmatter.
 */

/** Cortices requiring a userId in params (fleet-scoped work). */
export const USER_SCOPED_CORTICES: Set<string> = new Set([
  "fleet_analyst",
  "advisory_radar",
]);

/** Cortices that benefit from web-search enrichment on top of SQL data. */
export const WEB_ENRICHED_CORTICES: Set<string> = new Set([
  "launch_scout",
  "debris_forecaster",
  "regime_profiler",
  "advisory_radar",
  "apogee_tracker",
  "payload_profiler",
  "briefing_producer",
]);

/**
 * Cortices whose payload must pass the domainRelevance filter before LLM.
 * Typically those ingesting high-noise external feeds (RSS / web).
 */
export const RELEVANCE_FILTERED_CORTICES: Set<string> = new Set([
  "advisory_radar",
  "debris_forecaster",
]);

/** Fallback cortex list when the LLM planner emits an empty DAG. */
export const FALLBACK_CORTICES: string[] = [
  "fleet_analyst",
  "conjunction_analysis",
  "regime_profiler",
  "strategist",
];

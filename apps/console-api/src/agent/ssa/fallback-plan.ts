/**
 * SSA fallback DAG — consumed by `DomainConfig.fallbackPlan`.
 *
 * Used by ThalamusPlanner when the LLM planner emits an empty plan or
 * fails outright. Covers the SSA "broad sweep" intent: fleet + traffic
 * + regime + synthesis.
 *
 * Sibling to `daemon-dags.ts` — same shape (`DAGPlan`), different trigger
 * (fallback on LLM failure vs. cron).
 */

import type { DAGPlan } from "@interview/thalamus";

export function ssaFallbackPlan(query: string): DAGPlan {
  return {
    intent: query,
    complexity: "moderate",
    nodes: [
      { cortex: "fleet_analyst", params: { limit: 100 }, dependsOn: [] },
      {
        cortex: "conjunction_analysis",
        params: { window: "30d" },
        dependsOn: [],
      },
      {
        cortex: "regime_profiler",
        params: { focus: "underexplored" },
        dependsOn: [],
      },
      {
        cortex: "strategist",
        params: {},
        dependsOn: [
          "fleet_analyst",
          "conjunction_analysis",
          "regime_profiler",
        ],
      },
    ],
  };
}

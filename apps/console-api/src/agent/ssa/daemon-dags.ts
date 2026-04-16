/**
 * SSA daemon DAGs — pre-built research cycles for cron triggers.
 *
 * Consumed by the kernel via DomainConfig.daemonDags. Each entry is
 * looked up by job name; kernel executes the DAG without an LLM planner
 * call. Zero kernel knowledge of what `fleet_analyst` or `daily-scan` mean.
 */

import type { DAGPlan } from "@interview/thalamus";

export const SSA_DAEMON_DAGS: Record<string, DAGPlan> = {
  "daily-scan": {
    intent: "Daily scan for conjunction anomalies and tasking opportunities",
    complexity: "moderate",
    nodes: [
      { cortex: "fleet_analyst", params: { limit: 200 }, dependsOn: [] },
      { cortex: "conjunction_analysis", params: {}, dependsOn: [] },
      {
        cortex: "strategist",
        params: {},
        dependsOn: ["fleet_analyst", "conjunction_analysis"],
      },
    ],
  },
  "weekly-trends": {
    intent:
      "Weekly traffic analysis, orbital-regime insights, and advisory monitoring",
    complexity: "moderate",
    nodes: [
      { cortex: "fleet_analyst", params: { window: "7d" }, dependsOn: [] },
      {
        cortex: "regime_profiler",
        params: { focus: "underexplored" },
        dependsOn: [],
      },
      {
        cortex: "advisory_radar",
        params: { category: "ADVISORIES", days: 14 },
        dependsOn: [],
      },
      {
        cortex: "strategist",
        params: {},
        dependsOn: ["fleet_analyst", "regime_profiler", "advisory_radar"],
      },
    ],
  },
  "debris-forecast": {
    intent: "Monthly debris / fragmentation forecast",
    complexity: "simple",
    nodes: [
      {
        cortex: "debris_forecaster",
        params: { year: new Date().getFullYear() },
        dependsOn: [],
      },
    ],
  },
  "monthly-audit": {
    intent: "Monthly catalog data quality and classification audit",
    complexity: "deep",
    nodes: [
      { cortex: "data_auditor", params: { regime: "ALL" }, dependsOn: [] },
      { cortex: "classification_auditor", params: {}, dependsOn: [] },
    ],
  },
  "weekly-fleet": {
    intent: "Weekly fleet analysis and orbital-slot optimization",
    complexity: "moderate",
    nodes: [
      { cortex: "fleet_analyst", params: {}, dependsOn: [] },
      {
        cortex: "fleet_analyst",
        params: { mode: "slot_optimization" },
        dependsOn: [],
      },
      { cortex: "strategist", params: {}, dependsOn: ["fleet_analyst"] },
    ],
  },
  "content-generation": {
    intent: "Generate editorial briefing from accumulated research findings",
    complexity: "moderate",
    nodes: [
      { cortex: "briefing_producer", params: {}, dependsOn: [] },
      {
        cortex: "strategist",
        params: { pageType: "briefing" },
        dependsOn: [],
      },
      {
        cortex: "briefing_producer",
        params: { mode: "generate" },
        dependsOn: ["strategist"],
      },
    ],
  },
  "content-copilot": {
    intent: "Assist with briefing section rewriting using KG data",
    complexity: "simple",
    nodes: [
      {
        cortex: "briefing_producer",
        params: { mode: "copilot" },
        dependsOn: [],
      },
    ],
  },
  "content-audit": {
    intent: "Audit existing briefing content against KG",
    complexity: "simple",
    nodes: [
      {
        cortex: "strategist",
        params: { pageType: "briefing" },
        dependsOn: [],
      },
      {
        cortex: "briefing_producer",
        params: { mode: "audit" },
        dependsOn: ["strategist"],
      },
    ],
  },
};

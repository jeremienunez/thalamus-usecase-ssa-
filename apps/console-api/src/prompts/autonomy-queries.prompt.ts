// apps/console-api/src/prompts/autonomy-queries.prompt.ts
export const THALAMUS_QUERIES = [
  "Detect suspicious orbital behaviour — maneuvers, regime breakouts, missing telemetry",
  "Audit conjunction risk across the fleet — top Pc events and their operators",
  "Find catalog anomalies — mass, launch year, platform class gaps worth prioritising",
  "Correlate OSINT advisory feeds with current fleet — any flagged operators",
  "Surface high-opacity objects — low-confidence classifications needing follow-up",
  "Cross-check recent sim-fish suggestions with Thalamus findings — contradictions?",
] as const;

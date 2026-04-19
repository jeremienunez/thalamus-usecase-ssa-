// apps/console-api/src/prompts/autonomy-queries.prompt.ts
const QUERY_BIAS =
  "Prefer named satellites, named operators, ranked outputs, baseline deviations, repeated patterns, and directly observed deltas.";

const QUERY_EXCLUSIONS =
  "WHAT I DON'T NEED YOU TO DO: avoid threat framing, intent attribution, policy language, filler commentary, and explicit labels unless directly supported.";

function buildAutonomyQuery(objective: string): string {
  return `${objective} Return only materially ranked candidates backed by explicit observations or baseline deltas. If nothing material is supported, return no candidate. ${QUERY_BIAS} ${QUERY_EXCLUSIONS}`;
}

export const THALAMUS_QUERIES = [
  buildAutonomyQuery(
    "Review orbital state changes across the fleet. Prioritize maneuvers, regime shifts, telemetry gaps, repeated state deltas, and objects that depart from their recent baseline.",
  ),
  buildAutonomyQuery(
    "Review close-approach pressure across the fleet. Prioritize the highest Pc events, repeated pairings, recurrent operators, and near-term clusters that keep reappearing.",
  ),
  buildAutonomyQuery(
    "Review catalog consistency. Prioritize mass, launch year, and platform class fields whose completion would change classification quality or confidence.",
  ),
  buildAutonomyQuery(
    "Compare public reporting with current fleet state. Isolate operators, spacecraft, or patterns that need another verification pass, especially where multiple weak signals point in the same direction.",
  ),
  buildAutonomyQuery(
    "Surface low-visibility objects. Prioritize low-confidence classifications, sparse metadata, and weak corroboration paths for refinement.",
  ),
  buildAutonomyQuery(
    "Compare recent sim-fish suggestions with Thalamus findings. Isolate unresolved gaps, repeated mismatches, and cases where ranking should change after reconciliation.",
  ),
] as const;

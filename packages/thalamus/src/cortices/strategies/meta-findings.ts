import {
  ResearchFindingType,
  ResearchUrgency,
} from "@interview/shared/enum";
import type { CortexLlmDiagnostic } from "../cortex-llm";
import type { CortexFinding } from "../types";

export type CortexInputStats = {
  sqlRows: number;
  sourceRows: number;
  webRows: number;
  sampleKeys: string[];
};

export function buildNoFindingMetaFinding(
  cortexName: string,
  stats: CortexInputStats,
  diagnostic?: CortexLlmDiagnostic,
): CortexFinding {
  return diagnostic
    ? buildLlmOutputRejectedFinding(cortexName, diagnostic, stats)
    : buildDataGapFinding(cortexName, stats);
}

/**
 * Build a synthetic "data gap" finding — emitted when a cortex received data
 * but produced no findings (usually schema mismatch with the skill's declared
 * inputs). Makes the silence visible to the strategist and to `/api/stats`.
 */
function buildDataGapFinding(
  cortexName: string,
  stats: CortexInputStats,
): CortexFinding {
  const total = stats.sqlRows + stats.sourceRows + stats.webRows;
  return {
    title: `Cortex ${cortexName}: 0 findings from ${total} data items — possible schema mismatch`,
    summary:
      `The LLM received ${total} items (${stats.sqlRows} SQL, ${stats.sourceRows} structured sources, ${stats.webRows} web) ` +
      `but emitted no findings. Likely the skill's declared "Inputs from DATA" contract isn't met by the SQL helper output. ` +
      `Sample keys present: ${stats.sampleKeys.slice(0, 10).join(", ") || "—"}.`,
    findingType: ResearchFindingType.Anomaly,
    urgency: ResearchUrgency.Low,
    evidence: [
      {
        source: "cortex_audit",
        data: stats,
        weight: 1.0,
      },
    ],
    // Confidence intentionally above the 0.7 cycle-loop gate so the gap is
    // visible in persisted findings instead of being silently filtered.
    confidence: 0.7,
    impactScore: 3,
    sourceCortex: cortexName,
    edges: [],
  };
}

function buildLlmOutputRejectedFinding(
  cortexName: string,
  diagnostic: CortexLlmDiagnostic,
  stats: CortexInputStats,
): CortexFinding {
  const total = stats.sqlRows + stats.sourceRows + stats.webRows;
  return {
    title: `Cortex ${cortexName}: LLM output rejected — ${diagnostic.kind}`,
    summary:
      `The LLM received ${total} items (${stats.sqlRows} SQL, ${stats.sourceRows} structured sources, ${stats.webRows} web) ` +
      `but its response was rejected before persistence: ${diagnostic.reason}. ` +
      `No analytical findings were accepted from this cortex turn. ` +
      `Sample keys present: ${stats.sampleKeys.slice(0, 10).join(", ") || "—"}.`,
    findingType: ResearchFindingType.Anomaly,
    urgency: ResearchUrgency.Medium,
    evidence: [
      {
        source: "cortex_llm_guardrail",
        data: { diagnostic, stats },
        weight: 1.0,
      },
    ],
    confidence: 0.75,
    impactScore: 4,
    sourceCortex: cortexName,
    edges: [],
  };
}

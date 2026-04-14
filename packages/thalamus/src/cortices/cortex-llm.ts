/**
 * Cortex LLM Helper — Shared Kimi K2 structured output for all cortices.
 *
 * Every cortex follows the same pattern:
 * 1. Run SQL queries to get raw data.
 * 2. Feed data to Kimi K2 with a cortex-specific system prompt.
 * 3. Parse structured JSON response into CortexFinding[].
 *
 * This helper handles step 2-3.
 */

import { createLlmTransport } from "../transports/llm-chat";
import { createLogger } from "@interview/shared/observability";
import { extractJsonObject } from "../utils/llm-json-parser";
import type { CortexFinding } from "./types";

const logger = createLogger("cortex-llm");

export interface CortexLlmInput {
  cortexName: string;
  systemPrompt: string;
  dataPayload: string;
  maxFindings?: number;
  enableWebSearch?: boolean;
  lang?: "fr" | "en";
  mode?: "investment" | "audit";
}

/**
 * Call Kimi K2 (or OpenAI fallback) with cortex data and parse structured findings.
 * Returns raw findings array + token/model metadata.
 */
export async function analyzeCortexData(input: CortexLlmInput): Promise<{
  findings: CortexFinding[];
  model: string;
  tokensEstimate: number;
}> {
  const start = Date.now();

  const transport = createLlmTransport(input.systemPrompt, {
    enableWebSearch: input.enableWebSearch,
  });

  const langInstruction =
    input.lang === "en"
      ? "Write all titles and summaries in English."
      : "Redige tous les titres et resumes en francais.";

  const modeInstruction =
    input.mode === "audit"
      ? "Focus on DATA QUALITY: anomalies, misclassifications, missing fields, stale epochs, provenance gaps. Use findingType=anomaly."
      : "Focus on MISSION INSIGHTS: conjunctions, maneuver opportunities, debris risk, fleet health, launch-window signals. Do NOT report data-quality anomalies.";

  // If the skill defines its own output format, defer to the system prompt
  const hasCustomFormat = input.systemPrompt.includes("## Output Format");

  const userPrompt = hasCustomFormat
    ? `Follow the instructions in your system prompt exactly.
${langInstruction}

SOURCING RULE: Every claim you make must cite its source (URL, DOI, or data item from the DATA section). If you cannot cite a source for a value, set it to null — never guess.

DATA:
${input.dataPayload}

Respond with a JSON object: { "findings": [...] } as described in your Output Format section.
Max ${input.maxFindings ?? 3} findings.`
    : `Analyze the following SSA data and produce up to ${input.maxFindings ?? 3} findings.
${langInstruction}
${modeInstruction}

DATA:
${input.dataPayload}

Respond with a JSON object: { "findings": [...] }
Each finding needs:
- title: short headline
- summary: 1-2 sentences with numbers (epochs, probabilities, delta-v, altitude)
- findingType: anomaly|trend|forecast|insight|alert|opportunity
- urgency: low|medium|high|critical
- confidence: 0.0-1.0
- impactScore: 0-10
- evidence: [{"source":"...", "weight":1}]
- edges: [{"entityType":"satellite", "entityId":0, "relation":"about"}]
  Valid entityType values: satellite, operator, operator_country, launch,
  satellite_bus, payload, orbit_regime, conjunction_event, maneuver, finding.

If data comes from web search, use entityId:0 and describe the entity in evidence.source.
Keep it SHORT. Max ${input.maxFindings ?? 3} findings.`;

  try {
    const response = await transport.call(userPrompt);

    logger.debug(
      {
        cortex: input.cortexName,
        rawLen: response.content.length,
        raw: response.content.slice(0, 2000),
      },
      "Raw LLM response",
    );

    const parsed = extractJsonObject(response.content);
    const findings: CortexFinding[] =
      (parsed.findings as CortexFinding[]) ?? [];

    const duration = Date.now() - start;
    const tokensEstimate = Math.round(
      (input.systemPrompt.length +
        userPrompt.length +
        response.content.length) /
        4,
    );

    logger.info(
      {
        cortex: input.cortexName,
        provider: response.provider,
        findings: findings.length,
        duration,
      },
      "Cortex LLM analysis complete",
    );

    return {
      findings,
      model: `${response.provider}`,
      tokensEstimate,
    };
  } catch (err) {
    logger.error(
      { cortex: input.cortexName, err },
      "Cortex LLM analysis failed",
    );
    return { findings: [], model: "none", tokensEstimate: 0 };
  }
}

/**
 * Legacy wrapper — delegates to shared extractJsonObject parser.
 * Kept for backward compatibility with tests importing safeParseJson.
 */
export function safeParseJson(raw: string): { findings: CortexFinding[] } {
  const parsed = extractJsonObject(raw);
  const findings = (parsed.findings as CortexFinding[]) ?? [];
  // Also handle bare arrays (LLM returns [...] instead of {"findings": [...]})
  if (findings.length === 0 && Array.isArray(parsed.items)) {
    return { findings: parsed.items as CortexFinding[] };
  }
  return { findings };
}

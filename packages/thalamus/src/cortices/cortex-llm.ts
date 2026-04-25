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

import {
  createLlmTransport,
  LlmUnavailableError,
} from "../transports/llm-chat";
import { isAbortError } from "../transports/abort";
import type { ProviderName } from "../transports/providers";
import { createLogger, stepLog } from "@interview/shared/observability";
import { extractJsonObject } from "@interview/shared/utils";
import type { CortexFinding } from "./types";
import { getCortexConfig, getPlannerConfig } from "../config/runtime-config";

const logger = createLogger("cortex-llm");

export interface CortexLlmInput {
  cortexName: string;
  systemPrompt: string;
  dataPayload: string;
  maxFindings?: number;
  enableWebSearch?: boolean;
  lang?: "fr" | "en";
  mode?: "investment" | "audit";
  /** Domain-owned extra sourcing rules. The kernel injects these verbatim
   *  after its generic SOURCING RULE. Passed in by the strategy from
   *  DomainConfig.sourcingRules; optional. */
  sourcingRules?: string;
  /** Domain-owned finding-edge entityType vocabulary. Kernel was previously
   *  hardcoded to an SSA list; now injected. Falls back to a minimal
   *  placeholder when absent. */
  entityTypes?: string[];
  /** Domain-owned mode-specific user-prompt addenda. Kernel used to hardcode
   *  an SSA-flavored ternary (conjunctions / fleet health / stale epochs);
   *  now injected via DomainConfig.modeInstructions. Falls back to generic
   *  domain-neutral strings when absent. */
  modeInstructions?: {
    audit?: string;
    investment?: string;
  };
  signal?: AbortSignal;
}

/**
 * Generic audit-mode instruction — domain-neutral baseline. Domains may
 * override via DomainConfig.modeInstructions.audit (SSA mentions stale
 * epochs / misclassifications; other domains use their own vocabulary).
 */
const DEFAULT_AUDIT_MODE_INSTRUCTION =
  "Focus on DATA QUALITY: anomalies, missing fields, provenance gaps. Use findingType=anomaly.";

/**
 * Generic investment-mode instruction — domain-neutral baseline. Domains
 * override via DomainConfig.modeInstructions.investment (SSA mentions
 * conjunctions / maneuver opportunities / fleet health; other domains use
 * their own business vocabulary).
 */
const DEFAULT_INVESTMENT_MODE_INSTRUCTION =
  "Focus on actionable insights and opportunities relevant to the cortex's domain. Do NOT report data-quality anomalies.";

/**
 * Call Kimi K2 (or OpenAI fallback) with cortex data and parse structured findings.
 * Returns raw findings array + token/model metadata.
 */
export async function analyzeCortexData(input: CortexLlmInput): Promise<{
  findings: CortexFinding[];
  model: string;
  tokensEstimate: number;
  promptTokensEstimate?: number;
  completionTokensEstimate?: number;
  status?: CortexLlmStatus;
  diagnostic?: CortexLlmDiagnostic;
}> {
  const start = Date.now();

  // Per-cortex runtime override > planner default > provider env.
  const [cortexCfg, plannerCfg] = await Promise.all([
    getCortexConfig(),
    getPlannerConfig(),
  ]);
  const override = cortexCfg.overrides[input.cortexName] ?? {};
  // Fallback chain for "max findings the LLM may emit": caller-supplied
  // value > planner-config default > hardcoded 3.
  const effectiveMaxFindings =
    input.maxFindings ?? plannerCfg.maxFindingsPerCortex ?? 3;
  if (override.enabled === false) {
    logger.info(
      { cortex: input.cortexName },
      "cortex disabled via thalamus.cortex.overrides — returning zero findings",
    );
    stepLog(logger, "nano.call", "done", {
      cortex: input.cortexName,
      provider: "disabled",
      findings: 0,
      tokensEstimate: 0,
      durationMs: 0,
    });
    return {
      findings: [],
      model: "disabled",
      tokensEstimate: 0,
      status: "empty_valid",
    };
  }

  const pickProvider = (v: string | undefined): ProviderName | undefined => {
    if (v === "local" || v === "kimi" || v === "openai" || v === "minimax") {
      return v;
    }
    return undefined;
  };

  const transport = createLlmTransport(input.systemPrompt, {
    enableWebSearch: input.enableWebSearch,
    preferredProvider:
      pickProvider(override.provider) ?? pickProvider(plannerCfg.provider),
    overrides: {
      model: override.model ?? plannerCfg.model,
      maxOutputTokens: override.maxOutputTokens ?? plannerCfg.maxOutputTokens,
      temperature: override.temperature ?? plannerCfg.temperature,
      reasoningEffort: override.reasoningEffort ?? plannerCfg.reasoningEffort,
      verbosity: override.verbosity ?? plannerCfg.verbosity,
      thinking:
        typeof override.thinking === "boolean"
          ? override.thinking
          : plannerCfg.thinking,
      reasoningFormat: override.reasoningFormat ?? plannerCfg.reasoningFormat,
      reasoningSplit:
        typeof override.reasoningSplit === "boolean"
          ? override.reasoningSplit
          : plannerCfg.reasoningSplit,
    },
  });

  const langInstruction =
    input.lang === "en"
      ? "Write all titles and summaries in English."
      : "Redige tous les titres et resumes en francais.";

  // Mode instruction: domain-owned override wins, else kernel generic default.
  // SSA-specific vocabulary (conjunctions / fleet health / stale epochs) lives
  // in apps/console-api/src/agent/ssa/domain-config.ts, not here.
  const modeInstruction =
    input.mode === "audit"
      ? (input.modeInstructions?.audit ?? DEFAULT_AUDIT_MODE_INSTRUCTION)
      : (input.modeInstructions?.investment ??
        DEFAULT_INVESTMENT_MODE_INSTRUCTION);

  // If the skill defines its own output format, defer to the system prompt
  const hasCustomFormat = input.systemPrompt.includes("## Output Format");

  const domainRules = input.sourcingRules
    ? `\nDOMAIN RULES:\n${input.sourcingRules}\n`
    : "";
  const entityTypeLine = input.entityTypes?.length
    ? `  Valid entityType values: ${input.entityTypes.join(", ")}.`
    : `  entityType values are domain-specific; leave edges empty if unsure.`;
  const edgePlaceholder = input.entityTypes?.length
    ? `[{"entityType":"${input.entityTypes[0]}", "entityId":0, "relation":"about"}]`
    : `[]`;

  const userPrompt = hasCustomFormat
    ? `Follow the instructions in your system prompt exactly.
${langInstruction}

SOURCING RULE: Every claim you make must cite its source (URL, DOI, or data item from the DATA section). If you cannot cite a source for a value, set it to null — never guess.
${domainRules}
DATA:
${input.dataPayload}

Respond only with the JSON object described in your Output Format section.
Max ${effectiveMaxFindings} findings.`
    : `Analyze the following data and produce up to ${effectiveMaxFindings} findings.
${langInstruction}
${modeInstruction}
${domainRules}
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
- edges: ${edgePlaceholder}
${entityTypeLine}

If data comes from web search, use entityId:0 and describe the entity in evidence.source.
Keep it SHORT. Max ${effectiveMaxFindings} findings.`;

  stepLog(logger, "nano.call", "start", {
    cortex: input.cortexName,
    promptChars: input.systemPrompt.length + userPrompt.length,
    webSearch: !!input.enableWebSearch,
  });

  try {
    const response = input.signal
      ? await transport.call(userPrompt, { signal: input.signal })
      : await transport.call(userPrompt);
    const parsedResponse = parseCortexResponse(response.content);

    logger.debug(
      {
        cortex: input.cortexName,
        rawLen: response.content.length,
        raw: response.content.slice(
          0,
          parsedResponse.diagnostic?.kind === "degenerate_repetition"
            ? 500
            : 2000,
        ),
        diagnostic: parsedResponse.diagnostic,
      },
      "Raw LLM response",
    );

    const duration = Date.now() - start;
    const promptTokensEstimate = Math.round(
      (input.systemPrompt.length + userPrompt.length) / 4,
    );
    const completionTokensEstimate = Math.round(response.content.length / 4);
    const tokensEstimate = promptTokensEstimate + completionTokensEstimate;

    if (parsedResponse.diagnostic) {
      logger.warn(
        {
          cortex: input.cortexName,
          provider: response.provider,
          diagnostic: parsedResponse.diagnostic,
          duration,
        },
        "Cortex LLM response rejected",
      );
      stepLog(logger, "nano.call", "error", {
        cortex: input.cortexName,
        provider: response.provider,
        reason: parsedResponse.diagnostic.reason,
        durationMs: duration,
      });
      return {
        findings: [],
        model: `${response.provider}:invalid`,
        tokensEstimate,
        promptTokensEstimate,
        completionTokensEstimate,
        status: parsedResponse.status,
        diagnostic: parsedResponse.diagnostic,
      };
    }

    const findings = parsedResponse.findings;

    logger.info(
      {
        cortex: input.cortexName,
        provider: response.provider,
        findings: findings.length,
        duration,
      },
      "Cortex LLM analysis complete",
    );

    stepLog(logger, "nano.call", "done", {
      cortex: input.cortexName,
      provider: response.provider,
      findings: findings.length,
      tokensEstimate,
      durationMs: duration,
    });

    return {
      findings,
      model: `${response.provider}`,
      tokensEstimate,
      promptTokensEstimate,
      completionTokensEstimate,
      status: parsedResponse.status,
    };
  } catch (err) {
    if (isAbortError(err)) throw err;
    const diagnostic = diagnosticFromError(err);
    logger.error(
      { cortex: input.cortexName, err },
      "Cortex LLM analysis failed",
    );
    stepLog(logger, "nano.call", "error", {
      cortex: input.cortexName,
      durationMs: Date.now() - start,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      findings: [],
      model: "none",
      tokensEstimate: 0,
      status: diagnostic.kind,
      diagnostic,
    };
  }
}

/**
 * Legacy wrapper — delegates to shared extractJsonObject parser.
 * Kept for backward compatibility with tests importing safeParseJson.
 */
export function safeParseJson(raw: string): { findings: CortexFinding[] } {
  return { findings: parseCortexResponse(raw).findings };
}

export type CortexLlmStatus =
  | "ok"
  | "empty_valid"
  | "invalid_json"
  | "provider_unavailable"
  | "timeout"
  | "degenerate_repetition";

export type CortexLlmDiagnostic = {
  kind: Exclude<CortexLlmStatus, "ok" | "empty_valid">;
  reason: string;
  attemptedProviders?: string[];
  providerFailures?: Array<{ provider: string; message: string }>;
  repeatedUnit?: string;
  repeatedCount?: number;
};

export function parseCortexResponse(raw: string): {
  findings: CortexFinding[];
  status: CortexLlmStatus;
  diagnostic?: CortexLlmDiagnostic;
} {
  const repetition = detectDegenerateRepetition(raw);
  if (repetition) {
    return {
      findings: [],
      status: "degenerate_repetition",
      diagnostic: {
        kind: "degenerate_repetition",
        reason: `degenerate repetition detected: "${repetition.unit}" x${repetition.count}`,
        repeatedUnit: repetition.unit,
        repeatedCount: repetition.count,
      },
    };
  }

  if (!raw.trim()) {
    return invalidCortexResponse("empty provider response");
  }

  const parsed = extractJsonObject(raw);
  if (Array.isArray(parsed.findings)) {
    const findings = parsed.findings as CortexFinding[];
    return {
      findings,
      status: findings.length === 0 ? "empty_valid" : "ok",
    };
  }
  // Also handle bare arrays (LLM returns [...] instead of {"findings": [...]})
  if (Array.isArray(parsed.items)) {
    const findings = parsed.items as CortexFinding[];
    if (findings.length === 0) {
      return invalidCortexResponse(
        'empty output must be explicit JSON: {"findings":[]}',
      );
    }
    return { findings, status: "ok" };
  }

  if (raw.includes("findings")) {
    return invalidCortexResponse(
      "response mentioned findings but no valid findings array could be parsed",
    );
  }

  return invalidCortexResponse("response did not contain valid cortex JSON");
}

function invalidCortexResponse(reason: string): {
  findings: CortexFinding[];
  status: "invalid_json";
  diagnostic: CortexLlmDiagnostic;
} {
  return {
    findings: [],
    status: "invalid_json",
    diagnostic: {
      kind: "invalid_json",
      reason,
    },
  };
}

function diagnosticFromError(err: unknown): CortexLlmDiagnostic {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  if (err instanceof LlmUnavailableError) {
    return {
      kind: "provider_unavailable",
      reason: err.message,
      attemptedProviders: err.attemptedProviders,
      providerFailures: err.failures,
    };
  }
  const kind: CortexLlmDiagnostic["kind"] =
    name === "AbortError" || /timed?\s*out|timeout/i.test(message)
      ? "timeout"
      : "provider_unavailable";
  return {
    kind,
    reason: message,
  };
}

function detectDegenerateRepetition(
  raw: string,
): { unit: string; count: number } | null {
  const compact = raw.replace(/\s+/g, "");
  const minRepeatedChars = 120;
  const minCount = 24;
  const maxUnitLength = 12;

  for (let start = 0; start < compact.length; start += 1) {
    for (let unitLength = 1; unitLength <= maxUnitLength; unitLength += 1) {
      const unit = compact.slice(start, start + unitLength);
      if (unit.length < unitLength || !isMeaningfulRepeatedUnit(unit)) continue;

      let count = 1;
      let cursor = start + unitLength;
      while (compact.slice(cursor, cursor + unitLength) === unit) {
        count += 1;
        cursor += unitLength;
      }

      if (count >= minCount && count * unitLength >= minRepeatedChars) {
        return { unit: previewRepeatedUnit(unit), count };
      }
    }
  }

  return null;
}

function isMeaningfulRepeatedUnit(unit: string): boolean {
  return !/^[{}\[\]":,.\-0-9]+$/.test(unit);
}

function previewRepeatedUnit(unit: string): string {
  return unit.length <= 16 ? unit : `${unit.slice(0, 16)}...`;
}

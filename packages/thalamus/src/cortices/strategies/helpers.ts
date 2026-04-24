/**
 * Shared helpers for cortex execution strategies.
 *
 * `normalizeFinding` is re-exported from the executor module so external
 * callers (knowledge-graph write paths, tests) keep their existing import
 * path stable.
 */

import {
  ResearchFindingType,
  ResearchUrgency,
  ResearchRelation,
} from "@interview/shared/enum";
import type { CortexFinding, CortexOutput } from "../types";

export function emptyOutput(): CortexOutput {
  return {
    findings: [],
    metadata: { tokensUsed: 0, duration: 0, model: "none" },
  };
}

/**
 * Ensure finding has valid enum values and required fields.
 * LLM might return slightly off values — normalise them.
 */
export function normalizeFinding(
  raw: Partial<CortexFinding>,
  cortexName: string,
): CortexFinding {
  if (!raw) raw = {};
  return {
    title: raw.title ?? "Untitled finding",
    summary: raw.summary ?? "",
    findingType: validateEnum(
      raw.findingType,
      ResearchFindingType,
      ResearchFindingType.Insight,
    ),
    urgency: validateEnum(raw.urgency, ResearchUrgency, ResearchUrgency.Medium),
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    confidence: clamp(safeNumber(raw.confidence, 0.5), 0, 1),
    impactScore: clamp(safeNumber(raw.impactScore, 5), 0, 10),
    sourceCortex: cortexName,
    extensions: raw.extensions ?? undefined,
    dedupKey: raw.dedupKey ?? undefined,
    edges: Array.isArray(raw.edges)
      ? raw.edges.map((e) => ({
          entityType:
            typeof e.entityType === "string" && e.entityType.length > 0
              ? e.entityType
              : "unknown",
          entityId: Number(e.entityId) || 0,
          relation: validateEnum(
            e.relation,
            ResearchRelation,
            ResearchRelation.About,
          ),
          context: e.context,
        }))
      : [],
  };
}

function safeNumber(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function validateEnum<T extends Record<string, string>>(
  value: unknown,
  enumObj: T,
  fallback: T[keyof T],
): T[keyof T] {
  const valid = new Set(Object.values(enumObj));
  return valid.has(value as string) ? (value as T[keyof T]) : fallback;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * LLM response parser for the SSA audit provider (SRP).
 *
 * Extracts the audit-candidate list from a nano/LLM text response.
 * Defensive: non-matching or malformed output yields `[]` rather than
 * throwing, so one bad batch never poisons a wave.
 *
 * Kept as a pure function, deliberately separate from SsaAuditProvider:
 * the LLM output format evolves on its own axis (prompt tuning, model
 * upgrade) and must not force edits to the orchestration class.
 */
import type { AuditCandidate } from "@interview/sweep";
import { ssaResolutionPayloadSchema } from "./resolution-schema.ssa";

/** Valid finding categories (aligned with ssaCategoryEnum in resolution-schema). */
const CATEGORIES: ReadonlySet<string> = new Set([
  "mass_anomaly",
  "missing_data",
  "doctrine_mismatch",
  "relationship_error",
  "enrichment",
  "briefing_angle",
]);

/** Coerce unknown category string into the whitelist; fallback to `enrichment`. */
export function validCategory(c: string): string {
  return CATEGORIES.has(c) ? c : "enrichment";
}

/** Coerce unknown severity into the 3-level whitelist; fallback to `info`. */
export function validSeverity(s: string): string {
  return s === "critical" || s === "warning" || s === "info" ? s : "info";
}

/** Minimal shape needed to resolve operatorCountryId by name. */
export interface OperatorCountryLookup {
  id: bigint;
  name: string;
}

/**
 * Parse the LLM batch response.
 *
 * Guarantees:
 *  - No `[...]` array match in `text`     → `[]`
 *  - Bracket region is malformed JSON     → `[]`
 *  - Item missing `operatorCountry` OR
 *    `category` OR `title`                → dropped (filter, not throw)
 *  - Invalid `category` / `severity`      → coerced via whitelist
 *  - `title` / `description` / `suggestedAction` longer than
 *    200 / 1000 / 500 chars                → truncated (defensive cap)
 *  - Invalid `resolutionPayload` per Zod  → candidate kept, payload = null
 */
export function parseLlmSuggestions(
  text: string,
  operatorCountries: OperatorCountryLookup[],
): AuditCandidate[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let items: Record<string, unknown>[];
  try {
    const parsed = JSON.parse(match[0]);
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }

  return items
    .filter((item) => item.operatorCountry && item.category && item.title)
    .map((item) => {
      const operatorCountryName =
        typeof item.operatorCountry === "string" ? item.operatorCountry : "";
      const oc = operatorCountries.find(
        (a) =>
          a.name.toLowerCase() === operatorCountryName.toLowerCase(),
      );
      let resolutionPayload: string | null = null;
      if (item.resolutionPayload) {
        const parsed = ssaResolutionPayloadSchema.safeParse(
          item.resolutionPayload,
        );
        if (parsed.success) {
          resolutionPayload = JSON.stringify(parsed.data);
        }
      }
      return {
        domainFields: {
          operatorCountryId: oc?.id ?? null,
          operatorCountryName,
          category: validCategory(item.category as string),
          severity: validSeverity(item.severity as string),
          title: (item.title as string).slice(0, 200),
          description: ((item.description as string) ?? "").slice(0, 1000),
          affectedSatellites: Number(item.affectedSatellites) || 0,
          suggestedAction: ((item.suggestedAction as string) ?? "").slice(
            0,
            500,
          ),
          webEvidence: (item.webEvidence as string) ?? null,
        },
        resolutionPayload,
      };
    });
}

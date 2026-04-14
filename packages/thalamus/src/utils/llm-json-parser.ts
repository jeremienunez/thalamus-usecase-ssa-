/**
 * LLM JSON Parser — Extracts structured data from any LLM output.
 *
 * Handles: thinking tags, code fences, reasoning prefixes, Partial Mode
 * leftovers, bare arrays, truncated JSON, mixed text + JSON.
 *
 * 8 extraction strategies, tried in order of aggressiveness.
 * Returns the first valid parse, or null.
 */

import { createLogger } from "@interview/shared/observability";

const logger = createLogger("llm-json-parser");

/**
 * Clean LLM artifacts from raw output: thinking tags, code fences, whitespace.
 */
function cleanLlmOutput(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
}

/**
 * Repair truncated JSON by balancing brackets.
 */
function repairTruncated(text: string): string {
  let fixed = text.replace(/,\s*$/, "");
  const braceOpen = (fixed.match(/\{/g) || []).length;
  const braceClose = (fixed.match(/\}/g) || []).length;
  const bracketOpen = (fixed.match(/\[/g) || []).length;
  const bracketClose = (fixed.match(/\]/g) || []).length;
  fixed += "}".repeat(Math.max(0, braceOpen - braceClose));
  fixed += "]".repeat(Math.max(0, bracketOpen - bracketClose));
  return fixed;
}

/**
 * Extract JSON (object or array) from LLM text output.
 *
 * Tries 8 strategies from least to most aggressive:
 * 1. Direct parse
 * 2. Prepend "{" (Partial Mode leftover)
 * 3. Extract outermost {...}
 * 4. Extract outermost [...]
 * 5. Extract {...} with repair
 * 6. Extract [...] with repair
 * 7. Prepend "{" + repair
 * 8. Extract from code block
 *
 * @returns Parsed JSON value (object, array, etc.) or null if all fail.
 */
export function extractJson(raw: string): unknown | null {
  if (!raw || !raw.trim()) return null;

  const content = cleanLlmOutput(raw);

  const strategies: Array<() => unknown> = [
    // 1. Direct parse — clean JSON
    () => JSON.parse(content),

    // 2. Partial Mode leftover — missing opening brace
    () => JSON.parse("{" + content),

    // 3. Outermost JSON object
    () => {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no match");
      return JSON.parse(m[0]);
    },

    // 4. Outermost JSON array
    () => {
      const m = content.match(/\[\s*[\[{][\s\S]*[\]}]\s*\]/);
      if (!m) throw new Error("no match");
      return JSON.parse(m[0]);
    },

    // 5. Object with bracket repair (truncated output)
    () => {
      const m = content.match(/\{[\s\S]*$/);
      if (!m) throw new Error("no match");
      return JSON.parse(repairTruncated(m[0]));
    },

    // 6. Array with bracket repair
    () => {
      const m = content.match(/\[[\s\S]*$/);
      if (!m) throw new Error("no match");
      return JSON.parse(repairTruncated(m[0]));
    },

    // 7. Partial Mode leftover + repair
    () => JSON.parse(repairTruncated("{" + content)),

    // 8. Code block extraction (```json ... ```)
    () => {
      const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (!m) throw new Error("no match");
      return JSON.parse(m[1].trim());
    },
  ];

  for (const strategy of strategies) {
    try {
      const result = strategy();
      if (result !== null && result !== undefined) return result;
    } catch {
      // Next strategy
    }
  }

  logger.warn(
    { contentLen: content.length, preview: content.slice(0, 200) },
    "All JSON extraction strategies failed",
  );
  return null;
}

/**
 * Extract a JSON object from LLM output.
 * Returns the object, or an empty object if parsing fails.
 */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const result = extractJson(raw);
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  // If we got an array, wrap it (caller probably expected an object with an array field)
  if (Array.isArray(result)) {
    return { items: result };
  }
  return {};
}

/**
 * Extract a JSON array from LLM output.
 * Handles: bare arrays, arrays wrapped in objects, single objects → [object].
 */
export function extractJsonArray(raw: string): unknown[] {
  const result = extractJson(raw);
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") {
    // Object with a single array field → return that array
    const values = Object.values(result as Record<string, unknown>);
    const arrayField = values.find((v) => Array.isArray(v));
    if (arrayField) return arrayField as unknown[];
    // Single object → wrap in array
    return [result];
  }
  return [];
}

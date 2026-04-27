/**
 * Cortex Guardrails — Sanitize data before LLM injection.
 *
 * 3 layers:
 * 1. Strip prompt-injection patterns from RSS / external text.
 * 2. Filter off-topic content with caller-provided relevance keywords.
 * 3. Truncate + escape data payloads.
 */

import { createLogger } from "@interview/shared/observability";

const logger = createLogger("cortex-guardrails");

// ============================================================================
// Layer 1: Prompt Injection Patterns
// ============================================================================

const INJECTION_PATTERNS = [
  // Direct instruction override.
  /ignore\s+(previous|above|all)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(previous|above|all)/i,
  /forget\s+(everything|all|your)\s+(instructions?|rules?|training)/i,
  /new\s+instructions?:\s*/i,
  /system\s*:\s*/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  /<\|im_start\|>/i,

  // Role hijacking.
  /you\s+are\s+now\s+a/i,
  /act\s+as\s+(if\s+you\s+are|a)\s/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /switch\s+to\s+.+\s+mode/i,
  /enter\s+.+\s+mode/i,
  /jailbreak/i,
  /DAN\s+mode/i,

  // Data exfiltration.
  /reveal\s+(your|the)\s+(system|instructions?|prompt)/i,
  /show\s+(me\s+)?(your|the)\s+prompt/i,
  /what\s+are\s+your\s+instructions/i,
  /repeat\s+(the\s+)?(system|above)\s+(prompt|message|text)/i,

  // Code execution.
  /```\s*(python|javascript|bash|sh|exec)/i,
  /eval\s*\(/i,
  /exec\s*\(/i,
  /import\s+os/i,
  /__import__/i,
];

/**
 * Strip prompt injection patterns from text.
 * Returns sanitized text + count of patterns removed.
 */
export function sanitizeText(text: string): {
  clean: string;
  injections: number;
} {
  if (!text) return { clean: "", injections: 0 };
  let clean = String(text);
  let injections = 0;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(clean)) {
      clean = clean.replace(pattern, "[FILTERED]");
      injections++;
    }
  }

  return { clean, injections };
}

// ============================================================================
// Layer 2: Domain Content Filter — keywords injected by the app
// ============================================================================

/**
 * Scores how relevant a piece of text is to the caller's domain, by counting
 * matches against the domain's keyword vocabulary. Kernel-agnostic: the
 * keyword set is provided by the caller (app layer owns vocabulary).
 * 3+ matches = fully relevant (score 1.0).
 */
export function domainRelevance(
  title: string,
  summary: string,
  keywords: Set<string>,
): number {
  const text = `${title} ${summary}`.toLowerCase();
  const words = text.split(/\W+/);
  const matches = words.filter((w) => keywords.has(w)).length;
  return Math.min(1, matches / 3);
}

// ============================================================================
// Layer 3: Data Payload Sanitizer
// ============================================================================

const MAX_ITEM_LENGTH = 500;
const MAX_PAYLOAD_LENGTH = 15000;

function serializeWithinPayloadLimit(
  items: Record<string, unknown>[],
): string {
  const bounded = items.slice();
  let payload = JSON.stringify(bounded, null, 2);

  while (payload.length > MAX_PAYLOAD_LENGTH && bounded.length > 0) {
    bounded.pop();
    payload = JSON.stringify(bounded, null, 2);
  }

  return payload;
}

/**
 * Sanitize an array of data items before sending to LLM.
 * Strips injections, filters off-topic items, truncates. Callers pass
 * domain `keywords` when `requireDomainRelevance` is set.
 */
export function sanitizeDataPayload(
  items: Array<Record<string, unknown>>,
  opts?: {
    maxItems?: number;
    requireDomainRelevance?: boolean;
    keywords?: Set<string>;
  },
): {
  sanitized: string;
  stats: { total: number; filtered: number; injections: number };
} {
  const maxItems = opts?.maxItems ?? 50;
  let totalInjections = 0;
  let filtered = 0;

  const cleanItems: Record<string, unknown>[] = [];

  for (const item of items) {
    // Sanitize string fields.
    const cleanItem: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === "string") {
        const { clean, injections } = sanitizeText(value);
        totalInjections += injections;
        cleanItem[key] = clean.slice(0, MAX_ITEM_LENGTH);
      } else {
        cleanItem[key] = value;
      }
    }

    // Domain relevance filter — keywords provided by the caller.
    if (opts?.requireDomainRelevance && opts.keywords) {
      const title = String(cleanItem.title ?? cleanItem.name ?? "");
      const summary = String(cleanItem.summary ?? "");
      if (domainRelevance(title, summary, opts.keywords) < 0.3) {
        filtered++;
        continue;
      }
    }

    cleanItems.push(cleanItem);
    if (cleanItems.length >= maxItems) break;
  }

  const payload = serializeWithinPayloadLimit(cleanItems);

  if (totalInjections > 0) {
    logger.warn(
      { injections: totalInjections, filtered },
      "Prompt injection patterns detected and stripped",
    );
  }

  return {
    sanitized: payload,
    stats: { total: items.length, filtered, injections: totalInjections },
  };
}

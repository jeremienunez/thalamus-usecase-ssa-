import { DEFAULT_THALAMUS_BUDGETS_CONFIG } from "@interview/shared/config";

/**
 * Thalamus Research Agent — Configuration & Budget Limits.
 *
 * Cost estimates based on live testing against the SSA catalog
 * (~O(30k) tracked objects, Kimi K2):
 * - Average cycle: ~$0.003, ~45s, ~3 findings
 * - Full constellation/regime sweep: ~$0.14, ~27min
 * - Monthly budget (daemon): ~$0.25
 *
 * TODO (SPEC-TH-025) — these constants must become runtime-tunable via the
 * existing `PATCH /api/config/runtime/:domain` surface, same pattern as
 * `thalamus.nano` and `thalamus.nanoSwarm`. Until then, budget tweaks require
 * a redeploy. Tracked in:
 *   docs/specs/2026-04-18-thalamus-cortex-config-runtime.md
 *   apps/console-api/tests/e2e/runtime-config-cortex.stub.spec.ts
 */

// ─── Iteration Budgets by Complexity ──────────────────────
export interface IterationBudget {
  maxIterations: number;
  maxCost: number;
  confidenceTarget: number;
  coverageTarget: number;
  minFindingsToStop: number;
}

export const ITERATION_BUDGETS: Record<string, IterationBudget> = {
  ...DEFAULT_THALAMUS_BUDGETS_CONFIG,
};

/**
 * Diminishing returns: novelty threshold increases over iterations,
 * making it harder to justify continued iteration.
 * At iteration 1: ~0.5, at iteration 3: ~0.39, at iteration 6: ~0.35
 */
export function noveltyThreshold(iteration: number): number {
  return 0.3 + 0.2 * Math.exp(-0.5 * iteration);
}

export const THALAMUS_CONFIG = {
  // ─── Recursive Research Loop (global caps — per-complexity budgets above) ──
  loop: {
    maxIterationsPerChain: 10,
    maxCostPerChain: 0.1, // $0.10 — absolute cap
    maxCostPerDay: 0.5, // $0.50
    maxCostPerMonth: 5.0, // $5.00
    consecutiveZeroStop: 2, // Stop if 2 cycles produce 0 new findings
    confidenceTarget: 0.75, // Fallback if no complexity set
    minFindingsToStop: 3, // Fallback if no complexity set
  },

  // ─── Cortex Execution ─────────────────────────────────────
  cortex: {
    timeoutMs: 90_000, // 90s per cortex call
    maxItemsToLLM: 30, // Pre-summarized insights sent to LLM
    maxFindingsPerCortex: 3, // LLM asked to produce max 3 findings
  },

  // ─── Knowledge Graph ──────────────────────────────────────
  graph: {
    maxActiveFindings: 500, // DB trigger caps this
    ttlDays: {
      lowConfidence: 14, // confidence < 0.5
      medConfidence: 30, // 0.5 - 0.7
      highConfidence: 60, // 0.7 - 0.85
      veryHighConfidence: 90, // > 0.85
    },
  },

  // ─── Guardrails ───────────────────────────────────────────
  guardrails: {
    maxItemLength: 500, // Chars per item before truncation
    maxPayloadLength: 15_000, // Total payload to LLM
    domainRelevanceThreshold: 0.3, // Below = filtered as off-topic
  },

  // ─── Correlation Thresholds (SSA) ─────────────────────────
  correlation: {
    // Promotion threshold to actionable conjunction event. Field corroboration
    // from classified radar required to clear this bar.
    probabilityOfCollisionAlert: 1e-4, // standard NASA convention
    osintConfidenceRange: [0.2, 0.5] as const,
    fieldConfidenceRange: [0.85, 1.0] as const,
  },

  // ─── RSS Pipeline ─────────────────────────────────────────
  rss: {
    totalSources: 47, // 46 + Explorer virtual source
    ingestIntervalHours: 6,
    normalizeIntervalHours: 2,
    scoreIntervalHours: 3,
  },

  // ─── Resource Explorer ────────────────────────────────────
  explorer: {
    maxUrlsPerCycle: 50,
    maxConcurrentRequests: 3,
    pageTimeoutMs: 15_000,
    cycleTimeoutMs: 5 * 60 * 1000,
    maxQueriesPerCycle: 8,
    injectThreshold: { relevance: 0.7, novelty: 0.5 },
    promoteThreshold: { relevance: 0.8, appearances: 3 },
  },
} as const;

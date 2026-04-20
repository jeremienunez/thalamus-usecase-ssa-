/**
 * Cortex Types — Shared interface for all Thalamus cortices
 */

import type {
  ResearchFindingType,
  ResearchUrgency,
  ResearchRelation,
} from "@interview/shared/enum";

// ============================================================================
// Input / Output
// ============================================================================

export interface CortexInput {
  query: string;
  params: Record<string, unknown>;
  cycleId: bigint;
  lang?: "fr" | "en";
  mode?: "investment" | "audit";
  context?: {
    previousFindings?: Array<{
      title: string;
      summary: string;
      confidence: number;
    }>;
  };
}

export interface CortexFinding {
  title: string;
  summary: string;
  findingType: ResearchFindingType;
  urgency: ResearchUrgency;
  evidence: Array<{ source: string; data: unknown; weight: number }>;
  confidence: number;
  impactScore: number;
  /**
   * Name of the cortex that produced this finding. Stamped by normalizeFinding
   * so the persister can attribute findings correctly — a DAG runs many cortices
   * in parallel and the aggregated stream otherwise loses per-finding provenance.
   */
  sourceCortex?: string;
  /**
   * Generic extension point — domain-neutral bag for arbitrary metadata
   * emitted by a cortex. The kernel never inspects its shape. Domain-
   * specific consumers stamp their own sub-keys (e.g. SSA cortices write
   * `extensions.busContext = { busId, busName, similarity }`).
   */
  extensions?: Record<string, unknown>;
  dedupKey?: string;
  edges: Array<{
    entityType: string;
    entityId: number;
    relation: ResearchRelation;
    context?: Record<string, unknown>;
  }>;
}

export interface CortexOutput {
  findings: CortexFinding[];
  metadata: {
    tokensUsed: number;
    duration: number;
    model: string;
  };
}

// ============================================================================
// Cortex Interface
// ============================================================================

export interface Cortex {
  name: string;
  execute(input: CortexInput): Promise<CortexOutput>;
}

// ============================================================================
// Port: data provider injected by the app
// ============================================================================

/**
 * A named function that the cortex executor calls to fetch domain data.
 * The executor passes the skill's params; the app wraps a repo/service call.
 * No Database, no SQL, no domain knowledge in the kernel.
 */
export type DataProviderFn = (
  params: Record<string, unknown>,
) => Promise<unknown[]>;

/**
 * Map of sqlHelper names (from skill frontmatter) → data-fetcher functions.
 * Built by the app's composition root, injected into CortexExecutor.
 */
export type CortexDataProvider = Record<string, DataProviderFn>;

// ============================================================================
// Port: domain vocabulary + cortex classifications + pre-built DAGs
// ============================================================================

/** A single DAG node — kernel consumes by shape, never by cortex name. */
export interface DAGNode {
  cortex: string;
  params: Record<string, unknown>;
  dependsOn: string[];
}

export type QueryComplexity = "simple" | "moderate" | "deep";

export interface DAGPlan {
  intent: string;
  nodes: DAGNode[];
  complexity: QueryComplexity;
}

/**
 * Web-search prompt builder — domain-owned. Kernel passes `(query, cortex)`
 * and receives the prompt body. Returned `null` disables web search for
 * that cortex.
 */
export type WebSearchPromptFn = (
  query: string,
  cortexName: string,
) => { searchQuery: string; instruction: string };

/**
 * Identity pre-summarize — default, pass-through first 10 rows. Domains
 * override via DomainConfig.preSummarize with richer grouping logic.
 */
export const identityPreSummarize = (
  rows: Record<string, unknown>[],
  _cortexName: string,
): Record<string, unknown>[] => rows.slice(0, 10);

/**
 * No-op domain config — safe default for agents that don't run cycles
 * (e.g. CLI routing via HTTP). Every set empty, prompts minimal.
 */
export const noopDomainConfig: DomainConfig = {
  keywords: new Set(),
  userScopedCortices: new Set(),
  webEnrichedCortices: new Set(),
  relevanceFilteredCortices: new Set(),
  fallbackCortices: [],
  daemonDags: {},
  webSearchPrompt: (query, cortexName) => ({
    searchQuery: `${cortexName} ${query}`.slice(0, 200),
    instruction: `Search for data relevant to: ${query}`,
  }),
  preSummarize: identityPreSummarize,
};

/**
 * Domain config — everything the kernel needs from the app to execute a
 * cycle without hardcoding domain names, keywords, or pre-built DAGs.
 * Each field answers a kernel "need to know" question.
 */
export interface DomainConfig {
  /** Tokens for off-topic filtering in guardrails.domainRelevance. */
  keywords: Set<string>;
  /** Cortices requiring a userId in params (fleet-scoped work). */
  userScopedCortices: Set<string>;
  /** Cortices that benefit from web-search enrichment on empty SQL. */
  webEnrichedCortices: Set<string>;
  /** Cortices whose data payload must pass the domainRelevance filter. */
  relevanceFilteredCortices: Set<string>;
  /** Fallback cortex list when the LLM planner emits an empty DAG. */
  fallbackCortices: string[];
  /** Pre-built DAGs for cron / daemon triggers (no LLM call). */
  daemonDags: Record<string, DAGPlan>;
  /** Web-search prompt builder (domain prose). */
  webSearchPrompt: WebSearchPromptFn;
  /**
   * Pre-summarize raw data rows into aggregated insights before LLM narration.
   * Domain-specific grouping/aggregation logic (e.g. group by mission-health
   * signal, severity bucket, payload category). Default = pass-through.
   */
  /** Domain-owned sourcing rules injected into the finding-generation user
   *  prompt. The kernel stays domain-agnostic; SSA ships its NORAD cite rule
   *  here, other domains ship their own. Optional — absent means no extra
   *  rules beyond the kernel's generic SOURCING RULE. */
  sourcingRules?: string;
  /** Domain-owned list of valid `entityType` strings for finding edges. The
   *  kernel used to hardcode an SSA-specific list; moved here so other
   *  domains (threat-intel, pharmacovigilance…) ship their own vocabulary. */
  entityTypes?: string[];
  /**
   * Mode-specific user-prompt addenda. Kernel selects by `CortexInput.mode`
   * ("audit" | "investment"). Defaults to generic guidance; domains ship
   * flavored copies (e.g. SSA mentions conjunctions / fleet health /
   * stale epochs — vocabulary that otherwise would leak into the kernel).
   * Either key may be omitted; the kernel fills the gap with a domain-
   * neutral default.
   */
  modeInstructions?: {
    audit?: string;
    investment?: string;
  };
  preSummarize: (
    rows: Record<string, unknown>[],
    cortexName: string,
  ) => Record<string, unknown>[];

  // ── Phase 1 seams (agnosticity cleanup 2026-04-19) ──────────────────
  /**
   * Planner system-prompt builder. Kernel passes `{ headers, cortexNames }`;
   * receives the full system prompt string. If omitted, kernel falls back
   * to `buildGenericPlannerSystemPrompt`. Domains ship their flavored copy
   * here (e.g. SSA planner mentioning NORAD / fleet conventions).
   */
  plannerPrompt?: (input: {
    headers: string;
    cortexNames: readonly string[];
  }) => string;
  /**
   * Fallback DAG when planner LLM returns empty or fails outright. If
   * omitted, kernel flattens `fallbackCortices` into parallel no-dep nodes.
   */
  fallbackPlan?: (query: string) => DAGPlan;
  /**
   * Name of the synthesis cortex that must run last in every plan.
   * `StrategistStrategy.canHandle` compares cortex name against this.
   * Default when consumed: `"strategist"`.
   */
  synthesisCortexName?: string;
  /**
   * Optional entity-extraction hook used by nano-swarm when building
   * follow-up queries. If omitted, nano-swarm runs text-only grounding.
   */
  extractEntities?: (text: string) => {
    primary: string[];
    secondary?: string[];
    hasContent: boolean;
  };
  /**
   * Predicate: is a given entityType verification-relevant? Used by
   * `cycle-loop.service` to gate the `needsVerification` heuristic. If
   * omitted, the kernel defaults to "every type is verification-relevant".
   */
  isVerificationRelevantEntityType?: (entityType: string) => boolean;
}

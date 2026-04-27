/**
 * Port: domain vocabulary + cortex classifications + pre-built DAGs.
 *
 * Everything the kernel needs from the app to execute a cycle without
 * hardcoding domain names, keywords, or pre-built DAGs. Each field answers
 * a kernel "need to know" question.
 */

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
 * and receives the prompt body.
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
  /** Domain-owned sourcing rules injected into the finding-generation user
   *  prompt. The kernel stays domain-agnostic; the domain ships its own
   *  cite rule here. Optional — absent means no extra rules beyond the
   *  kernel's generic SOURCING RULE. */
  sourcingRules?: string;
  /** Domain-owned list of valid `entityType` strings for finding edges. The
   *  kernel used to hardcode a domain-specific list; moved here so each
   *  domain ships its own vocabulary. */
  entityTypes?: string[];
  /**
   * Mode-specific user-prompt addenda. Kernel selects by `CortexInput.mode`
   * ("audit" | "investment"). Defaults to generic guidance; domains ship
   * flavored copies. Either key may be omitted; the kernel fills the gap
   * with a domain-neutral default.
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
   * to `buildGenericPlannerSystemPrompt`.
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

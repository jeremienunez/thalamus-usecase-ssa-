/**
 * Cortex Types — Shared interface for all Thalamus cortices
 */

import type {
  ResearchCortex,
  ResearchFindingType,
  ResearchUrgency,
  ResearchEntityType,
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
   * Optional satellite-bus / platform-class context attached to the finding.
   * Carries SSA platform / bus identifiers.
   */
  busContext?: { busId: number; busName: string; similarity?: number };
  dedupKey?: string;
  edges: Array<{
    entityType: ResearchEntityType;
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
  name: ResearchCortex;
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
  preSummarize: (
    rows: Record<string, unknown>[],
    cortexName: string,
  ) => Record<string, unknown>[];
}

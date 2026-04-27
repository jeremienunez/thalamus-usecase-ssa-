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
  signal?: AbortSignal;
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
    promptTokens?: number;
    completionTokens?: number;
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

// Data-provider types live in ../ports/cortex-data-provider.port.ts; re-exported here for back-compat.
export type {
  CortexDataProvider,
  DataProviderFn,
} from "../ports/cortex-data-provider.port";

// ============================================================================
// Port: domain vocabulary + cortex classifications + pre-built DAGs
// ============================================================================

// DomainConfig + noopDomainConfig live in ../ports/domain-config.port.ts; re-exported here.
export type {
  DAGNode,
  DAGPlan,
  DomainConfig,
  QueryComplexity,
  WebSearchPromptFn,
} from "../ports/domain-config.port";
export {
  identityPreSummarize,
  noopDomainConfig,
} from "../ports/domain-config.port";

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

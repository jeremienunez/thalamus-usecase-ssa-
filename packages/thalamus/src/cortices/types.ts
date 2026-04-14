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

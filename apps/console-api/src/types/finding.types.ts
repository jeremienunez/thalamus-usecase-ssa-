// apps/console-api/src/types/finding.types.ts
import type {
  ResearchCortex,
  ResearchEntityType,
  ResearchFindingType,
  ResearchRelation,
  ResearchUrgency,
} from "@interview/shared/enum";

// ── Finding DTOs ────────────────────────────────────────────────────
export type FindingRow = {
  id: string;
  title: string;
  summary: string;
  cortex: string;
  status: string;
  confidence: number;
  created_at: Date | string;
  research_cycle_id: string;
};

export type FindingDetailRow = FindingRow & { evidence: unknown };

export type FindingInsertInput = {
  cycleId: bigint;
  cortex: ResearchCortex;
  findingType: ResearchFindingType;
  urgency: ResearchUrgency;
  title: string;
  summary: string;
  evidence: unknown;
  reasoning: string;
  confidence: number;
  impactScore: number;
};

export type EdgeRow = {
  finding_id: string;
  entity_type: string;
  entity_id: string;
};

export type FindingEdgeDisplayRow = {
  from_name: string;
  relation: string;
  to_name: string;
};

export type GraphNeighbourhoodRow = {
  from_name: string;
  from_type: string;
  relation: string;
  to_name: string;
  to_type: string;
  confidence: number;
};

export type EdgeInsertInput = {
  findingId: bigint;
  entityType:
    | ResearchEntityType.Satellite
    | ResearchEntityType.Operator
    | ResearchEntityType.OperatorCountry
    | ResearchEntityType.Payload
    | ResearchEntityType.OrbitRegime;
  entityId: bigint;
  relation:
    | ResearchRelation.About
    | ResearchRelation.Supports
    | ResearchRelation.Contradicts
    | ResearchRelation.SimilarTo;
  weight: number;
  context: unknown;
};

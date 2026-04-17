// apps/console-api/src/types/finding.types.ts
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
  cortex: string;
  findingType: string;
  urgency: string;
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

export type EdgeInsertInput = {
  findingId: bigint;
  entityType:
    | "satellite"
    | "operator"
    | "operator_country"
    | "payload"
    | "orbit_regime";
  entityId: bigint;
  relation:
    | "about"
    | "supports"
    | "contradicts"
    | "similar_to"
    | "derived_from";
  weight: number;
  context: unknown;
};

// apps/console-api/src/types/sweep.types.ts
import type { FindingInsertInput } from "./finding.types";

// ── Enrichment / feedback DTOs ──────────────────────────────────────
export type EmitArgs = {
  kind: "knn" | "mission";
  satelliteId: string;
  field: string;
  value: string | number;
  confidence: number;
  source: string;
  neighbourIds?: string[];
  cosSim?: number;
};

export type SweepFeedbackEntry = {
  category: string;
  wasAccepted: boolean;
  reviewerNote: string;
  operatorCountryName: string;
};

export type EnrichmentFindingEvidence = {
  source: "knn" | "web";
  data: {
    field: string;
    value: string | number;
    cosSim?: number;
    neighbours?: string[];
    url?: string;
  };
  weight: number;
};

export type EnrichmentFindingInsert = FindingInsertInput;

// ── Audit DTO ───────────────────────────────────────────────────────
export type AuditInsertInput = {
  suggestionId: string;
  operatorCountryName: string;
  title: string;
  description: string;
  suggestedAction: string;
  affectedSatellites: number;
  webEvidence: string;
  resolutionPayload: unknown;
};

/**
 * Durable audit row written by SsaPromotionAdapter after a resolution
 * succeeds. Mirrors the shape written today by sweep-resolution.service's
 * writeAudit() private method — see packages/sweep/src/services/
 * sweep-resolution.service.ts:210-257.
 *
 * Unlike AuditInsertInput (used by mission/knn enrichment flows and forces
 * category='enrichment'/severity='info'), this shape carries the full
 * reviewer-visible category/severity and the full resolution outcome.
 */
export type ResolutionAuditInsertInput = {
  suggestionId: string;
  operatorCountryId: string | null;
  operatorCountryName: string;
  /** One of the SweepCategory enum values; validated at drizzle insert. */
  category: string;
  /** One of the SweepSeverity enum values; validated at drizzle insert. */
  severity: string;
  title: string;
  description: string;
  suggestedAction: string;
  affectedSatellites: number;
  webEvidence: string | null;
  accepted: boolean;
  reviewerNote: string | null;
  reviewedAt: string;
  /** One of the SweepResolutionStatus enum values. */
  resolutionStatus: "success" | "partial" | "failed" | "pending_selection";
  resolutionPayload: unknown;
  resolutionErrors: string[] | null;
  resolvedAt: string;
};

// ── Suggestion list DTOs ────────────────────────────────────────────
export type SweepSuggestionRow = {
  id: string;
  title: string;
  description: string;
  suggestedAction: string;
  category: string;
  severity: string;
  operatorCountryName: string | null;
  affectedSatellites: number;
  createdAt: string;
  accepted: boolean;
  resolutionStatus: string;
  resolutionPayload: string | null;
};

export type SuggestionListItem = {
  id: string;
  title: string;
  description: string;
  suggestedAction: string;
  category: string;
  severity: string;
  operatorCountryName: string | null;
  affectedSatellites: number;
  createdAt: string;
  accepted: boolean;
  resolutionStatus: string;
  hasPayload: boolean;
};

// ── KNN propagation sample fill view ────────────────────────────────
export type KnnSampleFillView = {
  id: string;
  name: string;
  value: string | number;
  neighbourIds: string[];
  cosSim: number;
};

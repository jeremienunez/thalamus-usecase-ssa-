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

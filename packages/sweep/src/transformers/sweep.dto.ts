/**
 * Sweep DTOs — Zod schemas for nano-sweep admin endpoints (SSA).
 */

import { z } from "zod";
import { paginationSchema } from "./shared.dto";

// ─── Suggestion categories & severities ──────────────────────────────

export const sweepCategoryEnum = z.enum([
  "mass_anomaly",
  "missing_data",
  "doctrine_mismatch",
  "relationship_error",
  "enrichment",
  "briefing_angle",
]);
export type SweepCategory = z.infer<typeof sweepCategoryEnum>;

export const sweepModeEnum = z.enum(["dataQuality", "briefing", "nullScan"]);
export type SweepMode = z.infer<typeof sweepModeEnum>;

export const sweepSeverityEnum = z.enum(["critical", "warning", "info"]);
export type SweepSeverity = z.infer<typeof sweepSeverityEnum>;

// ─── List suggestions (GET /admin/sweep/suggestions) ─────────────────

export const listSuggestionsSchema = z.object({
  ...paginationSchema,
  category: sweepCategoryEnum.optional(),
  severity: sweepSeverityEnum.optional(),
  reviewed: z
    .enum(["true", "false", "all"])
    .default("all")
    .transform((v) => (v === "all" ? undefined : v === "true")),
});
export type ListSuggestionsQuery = z.infer<typeof listSuggestionsSchema>;

// ─── Review suggestion (PATCH /admin/sweep/suggestions/:id) ──────────

export const reviewSuggestionSchema = z.object({
  accepted: z.boolean(),
  reviewerNote: z.string().max(500).optional(),
});
export type ReviewSuggestionBody = z.infer<typeof reviewSuggestionSchema>;

// ─── Trigger sweep (POST /admin/sweep/trigger) ──────────────────────

export const triggerSweepSchema = z.object({
  maxOperatorCountries: z.coerce.number().int().min(1).max(2000).optional(),
  mode: sweepModeEnum.optional(),
});
export type TriggerSweepBody = z.infer<typeof triggerSweepSchema>;

// ─── Response DTOs ───────────────────────────────────────────────────

export const sweepSuggestionDto = z.object({
  id: z.string(),
  operatorCountryId: z.string().nullable(),
  operatorCountryName: z.string(),
  category: sweepCategoryEnum,
  severity: sweepSeverityEnum,
  title: z.string(),
  description: z.string(),
  affectedSatellites: z.number(),
  suggestedAction: z.string(),
  webEvidence: z.string().nullable(),
  accepted: z.boolean().nullable(),
  reviewerNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SweepSuggestionDto = z.infer<typeof sweepSuggestionDto>;

export const sweepStatsDto = z.object({
  totalSuggestions: z.number(),
  pending: z.number(),
  accepted: z.number(),
  rejected: z.number(),
  bySeverity: z.object({
    critical: z.number(),
    warning: z.number(),
    info: z.number(),
  }),
  byCategory: z.record(z.string(), z.number()),
});
export type SweepStatsDto = z.infer<typeof sweepStatsDto>;

// ─── Resolution Payload (structured fix from nano) ──────────

export const updateFieldActionSchema = z.object({
  kind: z.literal("update_field"),
  satelliteIds: z.array(z.string()).optional(),
  field: z.enum([
    "mass_kg",
    "launch_year",
    "orbit_regime_id",
    "operator_country_id",
    "platform_class_id",
  ]),
  value: z.union([z.string(), z.number()]),
});

export const linkPayloadActionSchema = z.object({
  kind: z.literal("link_payload"),
  satelliteIds: z.array(z.string()).optional(),
  payloadName: z.string(),
  role: z.enum(["primary", "secondary", "auxiliary"]).optional(),
});

export const unlinkPayloadActionSchema = z.object({
  kind: z.literal("unlink_payload"),
  satelliteIds: z.array(z.string()).optional(),
  payloadName: z.string(),
});

export const reassignOperatorCountryActionSchema = z.object({
  kind: z.literal("reassign_operator_country"),
  satelliteIds: z.array(z.string()).optional(),
  fromName: z.string(),
  toName: z.string(),
});

export const enrichActionSchema = z.object({
  kind: z.literal("enrich"),
  satelliteIds: z.array(z.string()).optional(),
});

export const resolutionActionSchema = z.discriminatedUnion("kind", [
  updateFieldActionSchema,
  linkPayloadActionSchema,
  unlinkPayloadActionSchema,
  reassignOperatorCountryActionSchema,
  enrichActionSchema,
]);
export type UpdateFieldAction = z.infer<typeof updateFieldActionSchema>;
export type LinkPayloadAction = z.infer<typeof linkPayloadActionSchema>;
export type UnlinkPayloadAction = z.infer<typeof unlinkPayloadActionSchema>;
export type ReassignOperatorCountryAction = z.infer<
  typeof reassignOperatorCountryActionSchema
>;
export type EnrichAction = z.infer<typeof enrichActionSchema>;
export type ResolutionAction =
  | UpdateFieldAction
  | LinkPayloadAction
  | UnlinkPayloadAction
  | ReassignOperatorCountryAction
  | EnrichAction;

export const resolutionPayloadSchema = z.object({
  type: sweepCategoryEnum,
  actions: z.array(resolutionActionSchema).min(1),
});
export type ResolutionPayload = z.infer<typeof resolutionPayloadSchema>;

// ─── Resolution Result ──────────────────────────────────────

export const selectionOptionSchema = z.object({
  value: z.union([z.string(), z.number()]),
  label: z.string(),
  detail: z.string().optional(),
});

export const pendingSelectionSchema = z.object({
  key: z.string(),
  label: z.string(),
  options: z.array(selectionOptionSchema),
});

export type PendingSelection = z.infer<typeof pendingSelectionSchema>;
export type SelectionOption = z.infer<typeof selectionOptionSchema>;

export const resolutionResultSchema = z.object({
  status: z.enum(["success", "partial", "failed", "pending_selection"]),
  resolvedAt: z.string().optional(),
  affectedRows: z.number(),
  errors: z.array(z.string()).optional(),
  pendingSelections: z.array(pendingSelectionSchema).optional(),
});
export type ResolutionResult = z.infer<typeof resolutionResultSchema>;

// ─── Resolve endpoint (POST /admin/sweep/suggestions/:id/resolve) ───

export const resolveSuggestionSchema = z.object({
  selections: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional(),
});
export type ResolveSuggestionBody = z.infer<typeof resolveSuggestionSchema>;

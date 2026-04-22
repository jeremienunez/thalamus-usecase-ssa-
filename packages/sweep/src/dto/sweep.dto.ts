/**
 * Sweep DTOs — package-owned generic schemas for the review loop.
 *
 * Domain packs own the concrete suggestion vocabulary, payload unions, and
 * route-level shapes. The engine only keeps the generic contract it needs to
 * parse resolution payloads, surface pending selections, and persist review
 * metadata.
 */

import { z } from "zod";
import { paginationSchema } from "./pagination.dto";

// ─── Generic list / review DTOs ─────────────────────────────────────

export const listSuggestionsSchema = z.object({
  ...paginationSchema,
  category: z.string().min(1).optional(),
  severity: z.string().min(1).optional(),
  reviewed: z
    .enum(["true", "false", "all"])
    .default("all")
    .transform((v) => (v === "all" ? undefined : v === "true")),
});
export type ListSuggestionsQuery = z.infer<typeof listSuggestionsSchema>;

export const reviewSuggestionSchema = z.object({
  accepted: z.boolean(),
  reviewerNote: z.string().max(500).optional(),
});
export type ReviewSuggestionBody = z.infer<typeof reviewSuggestionSchema>;

export const triggerSweepSchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  mode: z.string().min(1).optional(),
});
export type TriggerSweepBody = z.infer<typeof triggerSweepSchema>;

// ─── Generic suggestion / stats DTOs ────────────────────────────────

export const sweepSuggestionDto = z.object({
  id: z.string(),
  domain: z.string(),
  createdAt: z.string(),
  accepted: z.boolean().nullable(),
  reviewerNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  resolutionStatus: z.string(),
  resolvedAt: z.string().nullable(),
  resolutionErrors: z.string().nullable(),
  simSwarmId: z.string().nullable(),
  simDistribution: z.string().nullable(),
  domainFields: z.record(z.string(), z.unknown()),
  resolutionPayload: z.string().nullable(),
});
export type SweepSuggestionDto = z.infer<typeof sweepSuggestionDto>;

export const sweepStatsDto = z.object({
  totalSuggestions: z.number(),
  pending: z.number(),
  accepted: z.number(),
  rejected: z.number(),
  bySeverity: z.record(z.string(), z.number()),
  byCategory: z.record(z.string(), z.number()),
});
export type SweepStatsDto = z.infer<typeof sweepStatsDto>;

// ─── Generic resolution payload / result DTOs ───────────────────────

export const resolutionActionSchema = z
  .object({
    kind: z.string().min(1),
  })
  .catchall(z.unknown());
export type ResolutionAction = z.infer<typeof resolutionActionSchema>;

export const resolutionPayloadSchema = z.object({
  type: z.string().min(1).optional(),
  actions: z.array(resolutionActionSchema).min(1),
});
export type ResolutionPayload = z.infer<typeof resolutionPayloadSchema>;

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

export const resolveSuggestionSchema = z.object({
  selections: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional(),
});
export type ResolveSuggestionBody = z.infer<typeof resolveSuggestionSchema>;

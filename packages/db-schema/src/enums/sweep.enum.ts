import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Sweep enums — category, severity, resolution status.
 *
 * Sourced from [sweep.dto.ts](../../../sweep/src/transformers/sweep.dto.ts) where the
 * review-loop contract is declared. Replicated as pgEnum here to back the durable
 * `sweep_audit` table. Values MUST stay in sync with the DTO literal unions.
 */

export const sweepCategoryEnum = pgEnum("sweep_category", [
  "mass_anomaly",
  "missing_data",
  "doctrine_mismatch",
  "relationship_error",
  "enrichment",
  "briefing_angle",
]);
export type SweepCategory = (typeof sweepCategoryEnum.enumValues)[number];

export const sweepSeverityEnum = pgEnum("sweep_severity", [
  "critical",
  "warning",
  "info",
]);
export type SweepSeverity = (typeof sweepSeverityEnum.enumValues)[number];

export const sweepResolutionStatusEnum = pgEnum("sweep_resolution_status", [
  "success",
  "partial",
  "failed",
  "pending_selection",
]);
export type SweepResolutionStatus =
  (typeof sweepResolutionStatusEnum.enumValues)[number];

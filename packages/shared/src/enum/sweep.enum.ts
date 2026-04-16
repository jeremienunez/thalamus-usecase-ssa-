/**
 * Sweep enums — the review-loop vocabulary shared between the sweep package,
 * the db-schema (as pgEnum), and the console-api that renders suggestions.
 *
 * DB source of truth: `sweep_category`, `sweep_severity`, `sweep_resolution_status`
 * pgEnums in [packages/db-schema/src/enums/sweep.enum.ts](../../../db-schema/src/enums/sweep.enum.ts),
 * which derive their tuples from `Object.values()` of the TS enums below.
 */

export enum SweepCategory {
  MassAnomaly = "mass_anomaly",
  MissingData = "missing_data",
  DoctrineMismatch = "doctrine_mismatch",
  RelationshipError = "relationship_error",
  Enrichment = "enrichment",
  BriefingAngle = "briefing_angle",
}

export enum SweepSeverity {
  Critical = "critical",
  Warning = "warning",
  Info = "info",
}

export enum SweepResolutionStatus {
  Success = "success",
  Partial = "partial",
  Failed = "failed",
  PendingSelection = "pending_selection",
}

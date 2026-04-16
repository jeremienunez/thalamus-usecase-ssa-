import {
  pgTable,
  bigserial,
  bigint,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import type {
  SweepCategoryValue as SweepCategory,
  SweepSeverityValue as SweepSeverity,
  SweepResolutionStatusValue as SweepResolutionStatus,
} from "../enums";
import {
  sweepCategoryEnum,
  sweepSeverityEnum,
  sweepResolutionStatusEnum,
} from "../enums";
import { operatorCountry } from "./satellite";

/**
 * Sweep audit — durable trail of suggestion review outcomes.
 *
 * Design split:
 *   - Live suggestions stay in Redis with 90-day TTL (ephemeral, high-churn,
 *     dedup-heavy review queue). See [sweep.repository.ts](../../../sweep/src/repositories/sweep.repository.ts).
 *   - Once a suggestion is reviewed (accept/reject/resolve), a row lands here
 *     for permanent record: feedback loop tuning, compliance audit, operator
 *     accountability. This is the only Sweep state that outlives the TTL.
 *
 * Feedback columns (accepted, reviewerNote, reviewedAt) are the signal that
 * tunes the next nano-swarm run's prompt per category.
 */
export const sweepAudit = pgTable(
  "sweep_audit",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    suggestionId: text("suggestion_id").notNull(),
    operatorCountryId: bigint("operator_country_id", { mode: "bigint" })
      .references(() => operatorCountry.id),
    operatorCountryName: text("operator_country_name").notNull(),
    category: sweepCategoryEnum("category").$type<SweepCategory>().notNull(),
    severity: sweepSeverityEnum("severity").$type<SweepSeverity>().notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    suggestedAction: text("suggested_action").notNull(),
    affectedSatellites: integer("affected_satellites").notNull().default(0),
    webEvidence: text("web_evidence"),
    accepted: boolean("accepted"),
    reviewerNote: text("reviewer_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolutionStatus: sweepResolutionStatusEnum("resolution_status")
      .$type<SweepResolutionStatus>(),
    resolutionPayload: jsonb("resolution_payload"),
    resolutionErrors: jsonb("resolution_errors"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    categoryIdx: index("idx_sweep_audit_category").on(t.category),
    severityIdx: index("idx_sweep_audit_severity").on(t.severity, t.createdAt),
    reviewedIdx: index("idx_sweep_audit_reviewed").on(t.reviewedAt),
    suggestionIdx: index("idx_sweep_audit_suggestion").on(t.suggestionId),
  }),
);

export type SweepAudit = typeof sweepAudit.$inferSelect;
export type NewSweepAudit = typeof sweepAudit.$inferInsert;

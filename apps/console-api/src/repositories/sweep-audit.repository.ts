// apps/console-api/src/repositories/sweep-audit.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import { sweepAudit, type NewSweepAudit } from "@interview/db-schema";
import type {
  SweepCategory,
  SweepSeverity,
  SweepResolutionStatus,
} from "@interview/shared/enum";
import type {
  AuditInsertInput,
  ResolutionAuditInsertInput,
} from "../types/sweep.types";

export type {
  AuditInsertInput,
  ResolutionAuditInsertInput,
} from "../types/sweep.types";

export class SweepAuditRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Narrow audit write fired by the mission / KNN enrichment path — forces
   * category='enrichment' + severity='info' + status='success'. Leaves the
   * reviewer-visible category/severity to the full resolution audit below.
   */
  async insertEnrichmentSuccess(input: AuditInsertInput): Promise<void> {
    const payload = JSON.stringify(input.resolutionPayload);
    await this.db.execute(sql`
      INSERT INTO sweep_audit (
        suggestion_id, operator_country_name, category, severity,
        title, description, suggested_action, affected_satellites,
        web_evidence, accepted, resolution_status, resolution_payload, reviewed_at
      ) VALUES (
        ${input.suggestionId},
        ${input.operatorCountryName},
        'enrichment'::sweep_category,
        'info'::sweep_severity,
        ${input.title},
        ${input.description},
        ${input.suggestedAction},
        ${input.affectedSatellites},
        ${input.webEvidence},
        ${true},
        'success'::sweep_resolution_status,
        ${payload}::jsonb,
        NOW()
      )
    `);
  }

  /**
   * Full resolution audit write — preserves reviewer-visible category /
   * severity / reviewerNote / resolutionStatus from the accepted suggestion.
   * Mirrors packages/sweep/src/services/sweep-resolution.service.ts
   * writeAudit() (lines 210-257) so the pre- and post-refactor audit trails
   * are byte-identical.
   */
  async insertResolutionAudit(input: ResolutionAuditInsertInput): Promise<void> {
    const row: NewSweepAudit = {
      suggestionId: input.suggestionId,
      operatorCountryId: input.operatorCountryId
        ? BigInt(input.operatorCountryId)
        : null,
      operatorCountryName: input.operatorCountryName,
      category: input.category as SweepCategory,
      severity: input.severity as SweepSeverity,
      title: input.title,
      description: input.description,
      suggestedAction: input.suggestedAction,
      affectedSatellites: input.affectedSatellites,
      webEvidence: input.webEvidence,
      accepted: input.accepted,
      reviewerNote: input.reviewerNote,
      reviewedAt: new Date(input.reviewedAt),
      resolutionStatus: input.resolutionStatus as SweepResolutionStatus,
      resolutionPayload:
        input.resolutionPayload as unknown as Record<string, unknown>,
      resolutionErrors:
        input.resolutionErrors && input.resolutionErrors.length > 0
          ? input.resolutionErrors
          : null,
      resolvedAt: new Date(input.resolvedAt),
    };
    await this.db.insert(sweepAudit).values(row);
  }
}

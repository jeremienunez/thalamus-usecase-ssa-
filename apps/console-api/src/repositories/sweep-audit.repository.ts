// apps/console-api/src/repositories/sweep-audit.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

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

export class SweepAuditRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

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
}

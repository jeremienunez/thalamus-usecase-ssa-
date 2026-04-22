import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SweepAuditRepository } from "../../../src/repositories/sweep-audit.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SweepAuditRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SweepAuditRepository(harness.db);
});

beforeEach(async () => {
  await harness.reset();
  await seedFixtures();
});

afterAll(async () => {
  if (harness) await harness.close();
});

async function seedFixtures(): Promise<void> {
  await harness.db.execute(sql`
    INSERT INTO orbit_regime (id, name, altitude_band) VALUES
      (1, 'Low Earth Orbit', '160-2000km')
  `);
  await harness.db.execute(sql`
    INSERT INTO operator_country (id, name, slug, orbit_regime_id) VALUES
      (1, 'France', 'france', 1)
  `);
}

describe("SweepAuditRepository", () => {
  it("writes enrichment success rows with forced category/severity/status", async () => {
    await repo.insertEnrichmentSuccess({
      suggestionId: "sug-1",
      operatorCountryName: "France",
      title: "Applied enrichment",
      description: "KNN fill succeeded",
      suggestedAction: "accept",
      affectedSatellites: 2,
      webEvidence: "https://example.test/evidence",
      resolutionPayload: { field: "massKg", value: 1200 },
    });

    const result = await harness.db.execute<{
      category: string;
      severity: string;
      resolutionStatus: string;
      accepted: boolean | null;
      resolutionPayload: Record<string, unknown> | null;
    }>(sql`
      SELECT
        category::text AS category,
        severity::text AS severity,
        resolution_status::text AS "resolutionStatus",
        accepted,
        resolution_payload AS "resolutionPayload"
      FROM sweep_audit
      WHERE suggestion_id = 'sug-1'
    `);

    expect(result.rows).toEqual([
      {
        category: "enrichment",
        severity: "info",
        resolutionStatus: "success",
        accepted: true,
        resolutionPayload: { field: "massKg", value: 1200 },
      },
    ]);
  });

  it("writes full resolution audit rows including payload and errors", async () => {
    await repo.insertResolutionAudit({
      suggestionId: "sug-2",
      operatorCountryId: "1",
      operatorCountryName: "France",
      category: "mass_anomaly",
      severity: "warning",
      title: "Mass anomaly resolved",
      description: "Analyst confirmed the update",
      suggestedAction: "update mass",
      affectedSatellites: 1,
      webEvidence: null,
      accepted: true,
      reviewerNote: "looks good",
      reviewedAt: "2026-04-22T00:00:00Z",
      resolutionStatus: "partial",
      resolutionPayload: { field: "massKg", oldValue: 900, newValue: 1000 },
      resolutionErrors: ["secondary source unavailable"],
      resolvedAt: "2026-04-22T00:05:00Z",
    });

    const result = await harness.db.execute<{
      operatorCountryId: string | null;
      category: string;
      severity: string;
      resolutionStatus: string | null;
      resolutionPayload: Record<string, unknown> | null;
      resolutionErrors: string[] | null;
    }>(sql`
      SELECT
        operator_country_id::text AS "operatorCountryId",
        category::text AS category,
        severity::text AS severity,
        resolution_status::text AS "resolutionStatus",
        resolution_payload AS "resolutionPayload",
        resolution_errors AS "resolutionErrors"
      FROM sweep_audit
      WHERE suggestion_id = 'sug-2'
    `);

    expect(result.rows).toEqual([
      {
        operatorCountryId: "1",
        category: "mass_anomaly",
        severity: "warning",
        resolutionStatus: "partial",
        resolutionPayload: {
          field: "massKg",
          oldValue: 900,
          newValue: 1000,
        },
        resolutionErrors: ["secondary source unavailable"],
      },
    ]);
  });
});

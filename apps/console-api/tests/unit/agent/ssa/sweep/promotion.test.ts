import { describe, it, expect, vi } from "vitest";
import { SsaPromotionAdapter } from "../../../../../src/agent/ssa/sweep/promotion.ssa";
import type { SweepAuditRepository } from "../../../../../src/repositories/sweep-audit.repository";

function fakeAuditRepo() {
  return {
    insertResolutionAudit: vi.fn().mockResolvedValue(undefined),
    insertEnrichmentSuccess: vi.fn().mockResolvedValue(undefined),
  } as unknown as SweepAuditRepository & {
    insertResolutionAudit: ReturnType<typeof vi.fn>;
  };
}

describe("SsaPromotionAdapter.promote", () => {
  const input = {
    suggestionId: "sugg-1",
    domain: "ssa",
    domainFields: {
      operatorCountryId: 7n,
      operatorCountryName: "Testland",
      category: "enrichment",
      severity: "info",
      title: "Missing payload name",
      description: "17 satellites lack payload attribution",
      suggestedAction: "Backfill from CelesTrak",
      affectedSatellites: 17,
      webEvidence: "https://example.com/registry",
    },
    resolutionPayload: JSON.stringify({
      actions: [{ kind: "update_field", field: "payloadName", value: "X-1" }],
    }),
    reviewer: null,
    reviewerNote: "looks fine",
  };

  it("calls SweepAuditRepository.insertResolutionAudit with the full payload", async () => {
    const audit = fakeAuditRepo();
    const adapter = new SsaPromotionAdapter({ sweepAuditRepo: audit });

    const result = await adapter.promote(input);
    expect(result.ok).toBe(true);
    expect(audit.insertResolutionAudit).toHaveBeenCalledTimes(1);

    const call = audit.insertResolutionAudit.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      suggestionId: "sugg-1",
      operatorCountryId: "7",
      operatorCountryName: "Testland",
      category: "enrichment",
      severity: "info",
      title: "Missing payload name",
      description: "17 satellites lack payload attribution",
      suggestedAction: "Backfill from CelesTrak",
      affectedSatellites: 17,
      webEvidence: "https://example.com/registry",
      accepted: true,
      reviewerNote: "looks fine",
      resolutionStatus: "success",
      resolutionErrors: null,
    });
    expect(call.resolutionPayload).toEqual({
      actions: [{ kind: "update_field", field: "payloadName", value: "X-1" }],
    });
  });

  it("skips confidence promotion when confidence is null or omitted", async () => {
    const audit = fakeAuditRepo();
    const adapter = new SsaPromotionAdapter({
      sweepAuditRepo: audit,
      confidence: null,
    });
    const result = await adapter.promote(input);
    expect(result.ok).toBe(true);
  });

  it("returns ok with a soft errors[] when audit write throws (non-fatal)", async () => {
    const audit = fakeAuditRepo();
    audit.insertResolutionAudit.mockRejectedValueOnce(new Error("DB down"));
    const adapter = new SsaPromotionAdapter({ sweepAuditRepo: audit });

    const result = await adapter.promote(input);
    // Matches legacy writeAudit behaviour: the mutation already landed, the
    // audit trail is lost but resolution returns successful.
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]).toMatch(/DB down/);
  });

  it("handles null operatorCountryId + missing webEvidence", async () => {
    const audit = fakeAuditRepo();
    const adapter = new SsaPromotionAdapter({ sweepAuditRepo: audit });
    await adapter.promote({
      ...input,
      domainFields: {
        ...input.domainFields,
        operatorCountryId: null,
        webEvidence: null,
      },
    });
    const call = audit.insertResolutionAudit.mock.calls[0]?.[0];
    expect(call.operatorCountryId).toBeNull();
    expect(call.webEvidence).toBeNull();
  });

  it("handles a null resolutionPayload", async () => {
    const audit = fakeAuditRepo();
    const adapter = new SsaPromotionAdapter({ sweepAuditRepo: audit });
    await adapter.promote({ ...input, resolutionPayload: null });
    const call = audit.insertResolutionAudit.mock.calls[0]?.[0];
    expect(call.resolutionPayload).toBeNull();
  });
});

import { describe, it, expect, vi } from "vitest";
import type { AcceptedSuggestionInput } from "@interview/sweep";
import type { ConfidenceService } from "@interview/thalamus";
import { fakePort, typedSpy } from "@interview/test-kit";
import { SsaPromotionAdapter } from "../../../../../src/agent/ssa/sweep/promotion.ssa";
import type { SsaSweepAuditPort } from "../../../../../src/agent/ssa/sweep/promotion.ssa";

function fakeAuditPort() {
  const insertResolutionAudit = typedSpy<
    SsaSweepAuditPort["insertResolutionAudit"]
  >().mockResolvedValue(undefined);
  return {
    repo: fakePort<SsaSweepAuditPort>({
      insertResolutionAudit,
    }),
    insertResolutionAudit,
  };
}

describe("SsaPromotionAdapter.promote", () => {
  const input: AcceptedSuggestionInput = {
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

  it("calls the sweep audit port with the full payload", async () => {
    const audit = fakeAuditPort();
    const adapter = new SsaPromotionAdapter({ sweepAuditRepo: audit.repo });

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
    const audit = fakeAuditPort();
    const adapter = new SsaPromotionAdapter({
      sweepAuditRepo: audit.repo,
      confidence: null,
    });
    const result = await adapter.promote(input);
    expect(result.ok).toBe(true);
  });

  it("returns ok with a soft errors[] when audit write throws (non-fatal)", async () => {
    const audit = fakeAuditPort();
    audit.insertResolutionAudit.mockRejectedValueOnce(new Error("DB down"));
    const adapter = new SsaPromotionAdapter({ sweepAuditRepo: audit.repo });

    const result = await adapter.promote(input);
    // Matches legacy writeAudit behaviour: the mutation already landed, the
    // audit trail is lost but resolution returns successful.
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]).toMatch(/DB down/);
  });

  it("handles null operatorCountryId + missing webEvidence", async () => {
    const audit = fakeAuditPort();
    const adapter = new SsaPromotionAdapter({ sweepAuditRepo: audit.repo });
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
    const audit = fakeAuditPort();
    const adapter = new SsaPromotionAdapter({ sweepAuditRepo: audit.repo });
    await adapter.promote({ ...input, resolutionPayload: null });
    const call = audit.insertResolutionAudit.mock.calls[0]?.[0];
    expect(call.resolutionPayload).toBeNull();
  });

  it("coerces missing domain fields to empty strings / zero and still returns ok when confidence is wired", async () => {
    const audit = fakeAuditPort();
    const adapter = new SsaPromotionAdapter({
      sweepAuditRepo: audit.repo,
      confidence: {} as ConfidenceService,
    });

    const result = await adapter.promote({
      ...input,
      domainFields: {},
    });

    expect(result).toEqual({ ok: true });
    const call = audit.insertResolutionAudit.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      operatorCountryId: null,
      operatorCountryName: "",
      category: "",
      severity: "",
      title: "",
      description: "",
      suggestedAction: "",
      affectedSatellites: 0,
      webEvidence: null,
    });
  });

  it("stringifies non-Error audit failures into soft warnings", async () => {
    const audit = fakeAuditPort();
    audit.insertResolutionAudit.mockRejectedValueOnce("plain failure");
    const adapter = new SsaPromotionAdapter({ sweepAuditRepo: audit.repo });

    const result = await adapter.promote(input);

    expect(result.ok).toBe(true);
    expect(result.errors?.[0]).toContain("plain failure");
  });
});

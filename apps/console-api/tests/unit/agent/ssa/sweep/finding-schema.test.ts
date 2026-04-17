import { describe, it, expect } from "vitest";
import { ssaFindingSchema } from "../../../../../src/agent/ssa/sweep/finding-schema.ssa";

describe("SsaFindingSchema", () => {
  const sample = {
    operatorCountryId: 42n,
    operatorCountryName: "Testland",
    category: "enrichment" as const,
    severity: "info" as const,
    title: "Missing payload name",
    description: "17 satellites lack payload attribution",
    affectedSatellites: 17,
    suggestedAction: "Backfill from CelesTrak payload registry",
    webEvidence: "https://example.com/payload-index",
  };

  it("serializes the full SSA payload into flat fields (blob empty)", () => {
    const { flatFields, blob } = ssaFindingSchema.serialize(sample);
    expect(flatFields).toEqual({
      operatorCountryId: "42",
      operatorCountryName: "Testland",
      category: "enrichment",
      severity: "info",
      title: "Missing payload name",
      description: "17 satellites lack payload attribution",
      affectedSatellites: 17,
      suggestedAction: "Backfill from CelesTrak payload registry",
      webEvidence: "https://example.com/payload-index",
    });
    expect(blob).toEqual({});
  });

  it("accepts operatorCountryId as string|null and normalises to string|null", () => {
    expect(
      ssaFindingSchema.serialize({ ...sample, operatorCountryId: null })
        .flatFields.operatorCountryId,
    ).toBeNull();
    expect(
      ssaFindingSchema.serialize({ ...sample, operatorCountryId: "42" })
        .flatFields.operatorCountryId,
    ).toBe("42");
  });

  it("rejects unknown category", () => {
    expect(() =>
      ssaFindingSchema.serialize({ ...sample, category: "bogus" }),
    ).toThrow();
  });

  it("rejects unknown severity", () => {
    expect(() =>
      ssaFindingSchema.serialize({ ...sample, severity: "fatal" }),
    ).toThrow();
  });

  it("round-trips via deserialize — all flat fields preserved", () => {
    const serialized = ssaFindingSchema.serialize(sample);
    const flatFields: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(serialized.flatFields)) {
      flatFields[k] = v === null ? null : String(v);
    }
    const round = ssaFindingSchema.deserialize({ flatFields, blob: {} });
    expect(round).toMatchObject({
      operatorCountryId: "42",
      operatorCountryName: "Testland",
      category: "enrichment",
      severity: "info",
      title: "Missing payload name",
      description: "17 satellites lack payload attribution",
      affectedSatellites: 17,
      suggestedAction: "Backfill from CelesTrak payload registry",
      webEvidence: "https://example.com/payload-index",
    });
  });

  it("deserialize tolerates null flatFields (fresh Redis read of missing hash)", () => {
    const round = ssaFindingSchema.deserialize({
      flatFields: {
        operatorCountryId: null,
        operatorCountryName: null,
        category: null,
        severity: null,
        title: null,
        description: null,
        affectedSatellites: null,
        suggestedAction: null,
        webEvidence: null,
      },
      blob: {},
    });
    expect(round.affectedSatellites).toBe(0);
    expect(round.operatorCountryId).toBeNull();
    expect(round.webEvidence).toBeNull();
    expect(round.operatorCountryName).toBe("");
  });

  it("declares the expected indexed fields", () => {
    expect(ssaFindingSchema.indexedFields).toEqual([
      "operatorCountryId",
      "category",
      "severity",
      "accepted",
    ]);
  });
});

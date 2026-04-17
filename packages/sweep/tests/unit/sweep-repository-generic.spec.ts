/**
 * Dual-API contract test for SweepRepository.
 *
 * Asserts:
 *   1. Generic methods are opt-in and require a FindingDomainSchema.
 *   2. insertGeneric + listGeneric + getGeneric round-trip through the
 *      pack's schema without touching Redis layout.
 *   3. Old flat API (insertOne/list/getById) still sees flat SSA rows.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Redis from "ioredis-mock";
import type IORedis from "ioredis";
import { SweepRepository } from "../../src/repositories/sweep.repository";
import type { FindingDomainSchema } from "../../src/ports";

// Minimal FindingDomainSchema mirroring SsaFindingSchema without pulling in
// the console-api pack (packages can't import from apps).
const ssaLikeSchema: FindingDomainSchema = {
  indexedFields: ["operatorCountryId", "category", "severity"],
  serialize(input) {
    const f = input as Record<string, unknown>;
    return {
      flatFields: {
        operatorCountryId: f.operatorCountryId == null ? null : String(f.operatorCountryId),
        operatorCountryName: String(f.operatorCountryName ?? ""),
        category: String(f.category ?? ""),
        severity: String(f.severity ?? ""),
        title: String(f.title ?? ""),
        description: String(f.description ?? ""),
        affectedSatellites: Number(f.affectedSatellites ?? 0),
        suggestedAction: String(f.suggestedAction ?? ""),
        webEvidence: f.webEvidence == null ? null : String(f.webEvidence),
      },
      blob: {},
    };
  },
  deserialize(raw) {
    const f = raw.flatFields;
    return {
      operatorCountryId: f.operatorCountryId ?? null,
      operatorCountryName: f.operatorCountryName ?? "",
      category: f.category ?? "",
      severity: f.severity ?? "",
      title: f.title ?? "",
      description: f.description ?? "",
      affectedSatellites: Number(f.affectedSatellites ?? 0),
      suggestedAction: f.suggestedAction ?? "",
      webEvidence: f.webEvidence ?? null,
    };
  },
};

// Shared redis so beforeEach can flush state (ioredis-mock keeps data
// global across instances unless explicitly cleared).
let redis: IORedis;

beforeEach(async () => {
  redis = new Redis() as unknown as IORedis;
  await redis.flushall();
});

function makeRepo(withSchema = true) {
  return withSchema
    ? new SweepRepository({ redis, schema: ssaLikeSchema })
    : new SweepRepository(redis);
}

const sample = {
  operatorCountryId: 42n,
  operatorCountryName: "Testland",
  category: "enrichment" as const,
  severity: "info" as const,
  title: "Missing payload",
  description: "17 sats",
  affectedSatellites: 17,
  suggestedAction: "Backfill",
  webEvidence: "https://example.com",
};

describe("SweepRepository dual API", () => {
  it("accepts legacy constructor (IORedis) — schema-less mode", () => {
    expect(() => makeRepo(false)).not.toThrow();
  });

  it("accepts new opts constructor ({ redis, schema })", () => {
    expect(() => makeRepo(true)).not.toThrow();
  });

  it("insertGeneric throws without schema", async () => {
    const repo = makeRepo(false);
    await expect(
      repo.insertGeneric({
        domain: "ssa",
        domainFields: sample,
        resolutionPayload: null,
      }),
    ).rejects.toThrow(/requires a FindingDomainSchema/);
  });

  it("insertGeneric round-trips via getGeneric", async () => {
    const repo = makeRepo(true);
    const id = await repo.insertGeneric({
      domain: "ssa",
      domainFields: sample,
      resolutionPayload: null,
    });
    const row = await repo.getGeneric(id);
    expect(row).toBeTruthy();
    expect(row!.id).toBe(id);
    expect(row!.domain).toBe("ssa");
    expect(row!.domainFields).toMatchObject({
      operatorCountryName: "Testland",
      category: "enrichment",
      severity: "info",
      title: "Missing payload",
      description: "17 sats",
      affectedSatellites: 17,
      suggestedAction: "Backfill",
      webEvidence: "https://example.com",
    });
  });

  it("insertGeneric writes a flat row readable by the legacy getById", async () => {
    const repo = makeRepo(true);
    const id = await repo.insertGeneric({
      domain: "ssa",
      domainFields: sample,
      resolutionPayload: JSON.stringify({ actions: [{ kind: "enrich", satelliteIds: [] }] }),
    });
    const flat = await repo.getById(id);
    expect(flat).toBeTruthy();
    expect(flat!.operatorCountryName).toBe("Testland");
    expect(flat!.category).toBe("enrichment");
    expect(flat!.severity).toBe("info");
    expect(flat!.resolutionPayload).toMatch(/enrich/);
  });

  it("listGeneric returns generic rows for pending suggestions", async () => {
    const repo = makeRepo(true);
    await repo.insertGeneric({
      domain: "ssa",
      domainFields: sample,
      resolutionPayload: null,
    });
    await repo.insertGeneric({
      domain: "ssa",
      domainFields: { ...sample, title: "Another" },
      resolutionPayload: null,
    });
    const { rows, total } = await repo.listGeneric({ reviewed: false, limit: 10 });
    expect(total).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.domain).toBe("ssa");
    expect(rows[0]!.domainFields.title).toBeDefined();
  });

  it("listGeneric throws without schema", async () => {
    const repo = makeRepo(false);
    await expect(repo.listGeneric({})).rejects.toThrow(/requires a FindingDomainSchema/);
  });

  it("getGeneric returns null for an unknown id", async () => {
    const repo = makeRepo(true);
    expect(await repo.getGeneric("9999")).toBeNull();
  });

  it("legacy insertOne still returns a string id and produces a flat row", async () => {
    const repo = makeRepo(false);
    const id = await repo.insertOne({
      ...sample,
      resolutionPayload: null,
    });
    expect(typeof id).toBe("string");
    const row = await repo.getById(id);
    expect(row!.title).toBe("Missing payload");
  });
});

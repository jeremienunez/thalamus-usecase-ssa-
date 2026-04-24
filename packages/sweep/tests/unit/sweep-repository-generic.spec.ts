/**
 * Generic-first contract test for SweepRepository.
 *
 * Asserts:
 *   1. insertGeneric + listGeneric + getGeneric round-trip through the
 *      pack's schema without touching Redis layout.
 *   2. Schema-less mode still round-trips opaque domain fields through the
 *      fallback flat/blob serializer.
 *   3. insertOne remains an alias for insertGeneric.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Redis from "ioredis-mock";
import { SweepRepository } from "../../src/repositories/sweep.repository";
import type { FindingDomainSchema } from "../../src/ports";

const exampleSchema: FindingDomainSchema = {
  indexedFields: ["subjectId", "bucket", "priority"],
  serialize(input) {
    const f = input as Record<string, unknown>;
    return {
      flatFields: {
        subjectId: f.subjectId == null ? null : String(f.subjectId),
        groupName: String(f.groupName ?? ""),
        bucket: String(f.bucket ?? ""),
        priority: String(f.priority ?? ""),
        title: String(f.title ?? ""),
        summary: String(f.summary ?? ""),
        itemCount: Number(f.itemCount ?? 0),
        suggestedStep: String(f.suggestedStep ?? ""),
        referenceUrl: f.referenceUrl == null ? null : String(f.referenceUrl),
      },
      blob: {},
    };
  },
  deserialize(raw) {
    const f = raw.flatFields;
    return {
      subjectId: f.subjectId ?? null,
      groupName: f.groupName ?? "",
      bucket: f.bucket ?? "",
      priority: f.priority ?? "",
      title: f.title ?? "",
      summary: f.summary ?? "",
      itemCount: Number(f.itemCount ?? 0),
      suggestedStep: f.suggestedStep ?? "",
      referenceUrl: f.referenceUrl ?? null,
    };
  },
};

// Shared redis so beforeEach can flush state (ioredis-mock keeps data
// global across instances unless explicitly cleared).
let redis: Redis;

beforeEach(async () => {
  redis = new Redis();
  await redis.flushall();
});

function makeRepo(withSchema = true) {
  return withSchema
    ? new SweepRepository({ redis, schema: exampleSchema })
    : new SweepRepository(redis);
}

const sample = {
  subjectId: 42n,
  groupName: "Example Group",
  bucket: "coverage-gap" as const,
  priority: "info" as const,
  title: "Missing payload",
  summary: "17 items",
  itemCount: 17,
  suggestedStep: "Backfill",
  referenceUrl: "https://example.com",
};

describe("SweepRepository generic contract", () => {
  it("accepts legacy constructor (IORedis) — schema-less mode", () => {
    expect(() => makeRepo(false)).not.toThrow();
  });

  it("accepts new opts constructor ({ redis, schema })", () => {
    expect(() => makeRepo(true)).not.toThrow();
  });

  it("insertGeneric round-trips via getGeneric", async () => {
    const repo = makeRepo(true);
    const id = await repo.insertGeneric({
      domain: "example-domain",
      domainFields: sample,
      resolutionPayload: null,
    });
    const row = await repo.getGeneric(id);
    expect(row).toBeTruthy();
    expect(row!.id).toBe(id);
    expect(row!.domain).toBe("example-domain");
    expect(row!.domainFields).toMatchObject({
      groupName: "Example Group",
      bucket: "coverage-gap",
      priority: "info",
      title: "Missing payload",
      summary: "17 items",
      itemCount: 17,
      suggestedStep: "Backfill",
      referenceUrl: "https://example.com",
    });
  });

  it("getById returns the same generic view exposed by getGeneric", async () => {
    const repo = makeRepo(true);
    const id = await repo.insertGeneric({
      domain: "example-domain",
      domainFields: sample,
      resolutionPayload: JSON.stringify({
        actions: [{ kind: "domain-action", targetIds: [] }],
      }),
    });
    const row = await repo.getById(id);
    expect(row).toBeTruthy();
    expect(row!.domainFields).toMatchObject({
      groupName: "Example Group",
      bucket: "coverage-gap",
      priority: "info",
    });
    expect(row!.resolutionPayload).toMatch(/domain-action/);
  });

  it("listGeneric returns generic rows for pending suggestions", async () => {
    const repo = makeRepo(true);
    await repo.insertGeneric({
      domain: "example-domain",
      domainFields: sample,
      resolutionPayload: null,
    });
    await repo.insertGeneric({
      domain: "example-domain",
      domainFields: { ...sample, title: "Another" },
      resolutionPayload: null,
    });
    const { rows, total } = await repo.listGeneric({ reviewed: false, limit: 10 });
    expect(total).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.domain).toBe("example-domain");
    expect(rows[0]!.domainFields.title).toBeDefined();
  });

  it("paginates pending suggestions through the ranked index instead of loading every id", async () => {
    const repo = makeRepo(false);
    for (let i = 0; i < 5; i++) {
      await repo.insertGeneric({
        domain: "generic",
        domainFields: {
          title: `Suggestion ${i}`,
          severity: "info",
          category: "coverage",
        },
        resolutionPayload: null,
      });
    }

    const zrevrange = vi.spyOn(redis, "zrevrange");
    const { rows, total } = await repo.listGeneric({
      reviewed: false,
      page: 2,
      limit: 2,
    });

    expect(total).toBe(5);
    expect(rows).toHaveLength(2);
    expect(zrevrange).toHaveBeenCalledWith(
      "sweep:index:ranked:pending",
      2,
      3,
    );
    expect(
      zrevrange.mock.calls.some(
        ([key, start, end]) =>
          key === "sweep:index:all" && start === 0 && end === -1,
      ),
    ).toBe(false);
  });

  it("moves reviewed suggestions from pending indexes to reviewed indexes", async () => {
    const repo = makeRepo(false);
    const criticalId = await repo.insertGeneric({
      domain: "generic",
      domainFields: {
        title: "Critical suggestion",
        severity: "critical",
        category: "catalog",
      },
      resolutionPayload: null,
    });
    await repo.insertGeneric({
      domain: "generic",
      domainFields: {
        title: "Warning suggestion",
        severity: "warning",
        category: "catalog",
      },
      resolutionPayload: null,
    });

    await expect(repo.review(criticalId, true)).resolves.toBe(true);

    const pending = await repo.listGeneric({
      reviewed: false,
      severity: "critical",
      limit: 10,
    });
    const reviewed = await repo.listGeneric({
      reviewed: true,
      severity: "critical",
      limit: 10,
    });

    expect(pending).toMatchObject({ rows: [], total: 0 });
    expect(reviewed.total).toBe(1);
    expect(reviewed.rows[0]?.id).toBe(criticalId);
  });

  it("clears stale filtered pending indexes when rebuilding from legacy state", async () => {
    const repo = makeRepo(false);
    const staleCriticalId = await repo.insertGeneric({
      domain: "generic",
      domainFields: {
        title: "Stale critical suggestion",
        severity: "critical",
        category: "catalog",
      },
      resolutionPayload: null,
    });
    await repo.insertGeneric({
      domain: "generic",
      domainFields: {
        title: "Live warning suggestion",
        severity: "warning",
        category: "catalog",
      },
      resolutionPayload: null,
    });

    await redis.srem("sweep:index:pending", staleCriticalId);

    const pendingCritical = await repo.listGeneric({
      reviewed: false,
      severity: "critical",
      limit: 10,
    });

    expect(pendingCritical).toMatchObject({ rows: [], total: 0 });
  });

  it("schema-less mode round-trips flat fields and blob fields", async () => {
    const repo = makeRepo(false);
    const id = await repo.insertGeneric({
      domain: "generic",
      domainFields: {
        title: "Fallback row",
        priority: 3,
        active: true,
        subjectId: 42n,
        nested: { source: "blob" },
        tags: ["alpha", "beta"],
      },
      resolutionPayload: null,
    });
    const row = await repo.getGeneric(id);
    expect(row).toBeTruthy();
    expect(row!.domain).toBe("generic");
    expect(row!.domainFields).toMatchObject({
      title: "Fallback row",
      priority: "3",
      active: "true",
      subjectId: "42",
      nested: { source: "blob" },
      tags: ["alpha", "beta"],
    });
  });

  it("getGeneric returns null for an unknown id", async () => {
    const repo = makeRepo(true);
    expect(await repo.getGeneric("9999")).toBeNull();
  });

  it("insertOne remains an alias for insertGeneric", async () => {
    const repo = makeRepo(false);
    const id = await repo.insertOne({
      domain: "generic",
      domainFields: {
        title: "Missing payload",
      },
      resolutionPayload: null,
    });
    expect(typeof id).toBe("string");
    const row = await repo.getById(id);
    expect(row!.domainFields.title).toBe("Missing payload");
  });
});

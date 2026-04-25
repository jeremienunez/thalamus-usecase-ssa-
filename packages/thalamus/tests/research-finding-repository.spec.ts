import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@interview/db-schema";
import {
  ResearchFindingType,
  ResearchStatus,
  ResearchUrgency,
} from "@interview/shared/enum";
import { InvalidEmbeddingDimensionError } from "../src/errors/embedding";
import { ResearchFindingRepository } from "../src/repositories/research-finding.repository";
import type {
  NewResearchFinding,
  ResearchFinding,
} from "../src/types/research.types";

function makeEmbedding(head: number[] = [0.11, 0.22]): number[] {
  return [...head, ...Array(EMBEDDING_DIMENSIONS - head.length).fill(0)];
}

function makeFindingRow(
  overrides: Partial<ResearchFinding> = {},
): ResearchFinding {
  return {
    id: 101n,
    researchCycleId: 1n,
    cortex: "catalog",
    findingType: ResearchFindingType.Insight,
    status: ResearchStatus.Active,
    urgency: ResearchUrgency.Low,
    title: "Repository finding",
    summary: "Repository summary",
    evidence: [],
    reasoning: null,
    confidence: 0.8,
    impactScore: 4,
    extensions: null,
    reflexionNotes: null,
    iteration: 0,
    dedupHash: "dedup",
    embedding: makeEmbedding(),
    expiresAt: null,
    createdAt: new Date("2026-04-22T00:00:00.000Z"),
    updatedAt: new Date("2026-04-22T00:00:00.000Z"),
    ...overrides,
  };
}

function makeNewFinding(
  overrides: Partial<NewResearchFinding> = {},
): NewResearchFinding {
  return {
    researchCycleId: 1n,
    cortex: "catalog",
    findingType: ResearchFindingType.Insight,
    status: ResearchStatus.Active,
    urgency: ResearchUrgency.Low,
    title: "Repository finding",
    summary: "Repository summary",
    evidence: [],
    confidence: 0.8,
    impactScore: 4,
    iteration: 0,
    dedupHash: "dedup",
    embedding: makeEmbedding(),
    ...overrides,
  };
}

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn(() => {
      throw new Error("select should not be called");
    }),
    insert: vi.fn(() => {
      throw new Error("insert should not be called");
    }),
    update: vi.fn(() => {
      throw new Error("update should not be called");
    }),
    delete: vi.fn(() => {
      throw new Error("delete should not be called");
    }),
    execute: vi.fn(() => {
      throw new Error("execute should not be called");
    }),
    ...overrides,
  } as any;
}

describe("ResearchFindingRepository embedding validation", () => {
  it("rejects create with a wrong-dimension embedding before hitting the database", async () => {
    const db = makeDb();
    const repo = new ResearchFindingRepository(db);

    await expect(
      repo.create(makeNewFinding({ embedding: [0.11, 0.22] })),
    ).rejects.toThrow(InvalidEmbeddingDimensionError);
    await expect(
      repo.create(makeNewFinding({ embedding: [0.11, 0.22] })),
    ).rejects.toThrow("ResearchFindingRepository");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects upsert with a non-finite embedding before hitting the database", async () => {
    const db = makeDb();
    const repo = new ResearchFindingRepository(db);

    await expect(
      repo.upsertByDedupHash(
        makeNewFinding({ embedding: [Number.NaN, ...makeEmbedding().slice(1)] }),
      ),
    ).rejects.toThrow(InvalidEmbeddingDimensionError);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects direct vector reads with a wrong dimension before SQL execution", async () => {
    const db = makeDb();
    const repo = new ResearchFindingRepository(db);

    await expect(repo.searchBySimilarity([0.11, 0.22])).rejects.toThrow(
      "ResearchFindingRepository",
    );
    await expect(repo.findSimilar([0.11, 0.22], 0.7, 5)).rejects.toThrow(
      InvalidEmbeddingDimensionError,
    );
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe("ResearchFindingRepository.upsertByDedupHash", () => {
  it("inserts through the conflict-safe path without preselecting by hash", async () => {
    const row = makeFindingRow();
    const insertReturning = vi.fn(async () => [row]);
    const onConflictDoNothing = vi.fn(() => ({ returning: insertReturning }));
    const insertValues = vi.fn(() => ({ onConflictDoNothing }));
    const db = makeDb({
      insert: vi.fn(() => ({ values: insertValues })),
    });
    const repo = new ResearchFindingRepository(db);

    await expect(repo.upsertByDedupHash(makeNewFinding())).resolves.toEqual({
      finding: row,
      inserted: true,
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(onConflictDoNothing).toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("updates the existing hash when the insert conflict path returns no row", async () => {
    const row = makeFindingRow({ id: 202n, iteration: 3 });
    const insertReturning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning: insertReturning }));
    const insertValues = vi.fn(() => ({ onConflictDoNothing }));
    const updateReturning = vi.fn(async () => [row]);
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const db = makeDb({
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    });
    const repo = new ResearchFindingRepository(db);

    await expect(repo.upsertByDedupHash(makeNewFinding())).resolves.toEqual({
      finding: row,
      inserted: false,
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        confidence: 0.8,
        evidence: [],
        summary: "Repository summary",
        embedding: expect.any(Array),
        status: ResearchStatus.Active,
      }),
    );
  });
});

describe("ResearchFindingRepository cycle links and semantic rows", () => {
  it("returns whether linkToCycle inserted a new junction row", async () => {
    const returning = vi
      .fn()
      .mockResolvedValueOnce([{ researchFindingId: 101n }])
      .mockResolvedValueOnce([]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const insertValues = vi.fn(() => ({ onConflictDoNothing }));
    const db = makeDb({
      insert: vi.fn(() => ({ values: insertValues })),
    });
    const repo = new ResearchFindingRepository(db);

    await expect(
      repo.linkToCycle({
        cycleId: 1n,
        findingId: 101n,
        iteration: 0,
        isDedupHit: false,
      }),
    ).resolves.toBe(true);
    await expect(
      repo.linkToCycle({
        cycleId: 1n,
        findingId: 101n,
        iteration: 0,
        isDedupHit: false,
      }),
    ).resolves.toBe(false);
  });

  it("normalizes raw SQL similarity rows through the finding transformer", async () => {
    const row = { ...makeFindingRow(), similarity: "0.91" };
    const db = makeDb({
      execute: vi.fn(async () => ({ rows: [row] })),
    });
    const repo = new ResearchFindingRepository(db);

    await expect(repo.searchBySimilarity(makeEmbedding(), 1)).resolves.toEqual([
      expect.objectContaining({
        id: 101n,
        title: "Repository finding",
        similarity: 0.91,
      }),
    ]);
  });
});

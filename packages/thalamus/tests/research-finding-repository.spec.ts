import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@interview/db-schema";
import {
  ResearchFindingType,
  ResearchStatus,
  ResearchUrgency,
} from "@interview/shared/enum";
import { InvalidEmbeddingDimensionError } from "../src/errors/embedding";
import { ResearchFindingRepository } from "../src/repositories/research-finding.repository";
import type { ResearchWriterPort } from "../src/ports/research-writer.port";
import type {
  NewResearchFinding,
  ResearchFinding,
} from "../src/types/research.types";

type ResearchFindingDb = ConstructorParameters<
  typeof ResearchFindingRepository
>[0];

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

function makeDb(overrides: Record<string, unknown> = {}): ResearchFindingDb {
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
  } as ResearchFindingDb;
}

function makeWriter(
  overrides: Partial<ResearchWriterPort> = {},
): ResearchWriterPort {
  return {
    createCycle: vi.fn(() =>
      Promise.reject(new Error("createCycle should not be called")),
    ),
    incrementCycleFindings: vi.fn(() =>
      Promise.reject(new Error("incrementCycleFindings should not be called")),
    ),
    updateCycleFindingsCount: vi.fn(() =>
      Promise.reject(
        new Error("updateCycleFindingsCount should not be called"),
      ),
    ),
    createEdges: vi.fn(() =>
      Promise.reject(new Error("createEdges should not be called")),
    ),
    createFinding: vi.fn(() =>
      Promise.reject(new Error("createFinding should not be called")),
    ),
    upsertFindingByDedupHash: vi.fn(() =>
      Promise.reject(new Error("upsertFindingByDedupHash should not be called")),
    ),
    linkFindingToCycle: vi.fn(() =>
      Promise.reject(new Error("linkFindingToCycle should not be called")),
    ),
    emitFindingTransactional: vi.fn(() =>
      Promise.reject(
        new Error("emitFindingTransactional should not be called"),
      ),
    ),
    ...overrides,
  };
}

describe("ResearchFindingRepository embedding validation", () => {
  it("rejects create with a wrong-dimension embedding before hitting the database", async () => {
    const db = makeDb();
    const writer = makeWriter();
    const repo = new ResearchFindingRepository(db, writer);

    await expect(
      repo.create(makeNewFinding({ embedding: [0.11, 0.22] })),
    ).rejects.toThrow(InvalidEmbeddingDimensionError);
    await expect(
      repo.create(makeNewFinding({ embedding: [0.11, 0.22] })),
    ).rejects.toThrow("ResearchFindingRepository");
    expect(db.insert).not.toHaveBeenCalled();
    expect(writer.createFinding).not.toHaveBeenCalled();
  });

  it("rejects upsert with a non-finite embedding before hitting the database", async () => {
    const db = makeDb();
    const writer = makeWriter();
    const repo = new ResearchFindingRepository(db, writer);

    await expect(
      repo.upsertByDedupHash(
        makeNewFinding({ embedding: [Number.NaN, ...makeEmbedding().slice(1)] }),
      ),
    ).rejects.toThrow(InvalidEmbeddingDimensionError);
    expect(db.insert).not.toHaveBeenCalled();
    expect(writer.upsertFindingByDedupHash).not.toHaveBeenCalled();
  });

  it("rejects direct vector reads with a wrong dimension before SQL execution", async () => {
    const db = makeDb();
    const repo = new ResearchFindingRepository(db, makeWriter());

    await expect(repo.searchBySimilarity([0.11, 0.22])).rejects.toThrow(
      "ResearchFindingRepository",
    );
    await expect(repo.findSimilar([0.11, 0.22], 0.7, 5)).rejects.toThrow(
      InvalidEmbeddingDimensionError,
    );
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe("ResearchFindingRepository cycle links and semantic rows", () => {
  it("normalizes raw SQL similarity rows through the finding transformer", async () => {
    const row = { ...makeFindingRow(), similarity: "0.91" };
    const db = makeDb({
      execute: vi.fn(() => Promise.resolve({ rows: [row] })),
    });
    const repo = new ResearchFindingRepository(db, makeWriter());

    await expect(repo.searchBySimilarity(makeEmbedding(), 1)).resolves.toEqual([
      expect.objectContaining({
        id: 101n,
        title: "Repository finding",
        similarity: 0.91,
      }),
    ]);
  });
});

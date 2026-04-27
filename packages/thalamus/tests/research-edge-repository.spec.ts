import { describe, expect, it, vi } from "vitest";
import { ResearchRelation } from "@interview/shared/enum";
import { ResearchEdgeRepository } from "../src/repositories/research-edge.repository";
import type { ResearchWriterPort } from "../src/ports/research-writer.port";
import type {
  NewResearchEdge,
  ResearchEdge,
} from "../src/types/research.types";

type ResearchEdgeDb = ConstructorParameters<typeof ResearchEdgeRepository>[0];

function makeNewEdge(overrides: Partial<NewResearchEdge> = {}): NewResearchEdge {
  return {
    findingId: 101n,
    entityType: "satellite",
    entityId: 42n,
    relation: ResearchRelation.About,
    weight: 0.9,
    context: { source: "unit" },
    ...overrides,
  };
}

function makeEdgeRow(overrides: Partial<ResearchEdge> = {}): ResearchEdge {
  return {
    id: 501n,
    findingId: 101n,
    entityType: "satellite",
    entityId: 42n,
    relation: ResearchRelation.About,
    weight: 0.9,
    context: { source: "unit" },
    createdAt: new Date("2026-04-27T00:00:00.000Z"),
    ...overrides,
  };
}

function makeDb(overrides: Record<string, unknown> = {}): ResearchEdgeDb {
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
  } as ResearchEdgeDb;
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

describe("ResearchEdgeRepository writes", () => {
  it("returns an empty list without touching the writer for empty batches", async () => {
    const db = makeDb();
    const writer = makeWriter();
    const repo = new ResearchEdgeRepository(db, writer);

    await expect(repo.createMany([])).resolves.toEqual([]);
    expect(writer.createEdges).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("delegates edge creation to the single writer port", async () => {
    const input = makeNewEdge();
    const row = makeEdgeRow();
    const db = makeDb();
    const writer = makeWriter({
      createEdges: vi.fn(() => Promise.resolve([row])),
    });
    const repo = new ResearchEdgeRepository(db, writer);

    await expect(repo.createMany([input])).resolves.toEqual([row]);
    expect(writer.createEdges).toHaveBeenCalledWith([input]);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

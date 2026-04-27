import { describe, expect, it, vi } from "vitest";
import {
  ResearchCortex,
  ResearchFindingType,
  ResearchStatus,
} from "@interview/shared/enum";
import { createResearchWriter } from "../../../src/services/research-write.service";

type ResearchWriter = ReturnType<typeof createResearchWriter>;
type ResearchWriterDb = Parameters<typeof createResearchWriter>[0];
type FindingInput = Parameters<ResearchWriter["createFinding"]>[0];
type LinkInput = Parameters<ResearchWriter["linkFindingToCycle"]>[0];

function makeDb(overrides: Record<string, unknown> = {}): ResearchWriterDb {
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
  } as ResearchWriterDb;
}

describe("ResearchWriteService business writer", () => {
  it("given a research finding DTO, when createFinding runs, then it inserts through the single research writer surface", async () => {
    const row = { id: 101n, title: "Writer finding" };
    const returning = vi.fn(() => Promise.resolve([row]));
    const values = vi.fn(() => ({ returning }));
    const db = makeDb({
      insert: vi.fn(() => ({ values })),
    });
    const writer = createResearchWriter(db);
    const input: FindingInput = {
      researchCycleId: 1n,
      cortex: ResearchCortex.Catalog,
      findingType: ResearchFindingType.Insight,
      status: ResearchStatus.Active,
      title: "Writer finding",
      summary: "Writer summary",
      evidence: [],
      confidence: 0.8,
      impactScore: 4,
      embedding: null,
      dedupHash: "dedup",
    };

    await expect(writer.createFinding(input)).resolves.toMatchObject(row);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(input);
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it("given a deduped finding DTO, when upsertFindingByDedupHash inserts a new row, then it uses onConflictDoNothing and does not update", async () => {
    const row = { id: 101n, title: "Inserted finding" };
    const returning = vi.fn(() => Promise.resolve([row]));
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const db = makeDb({
      insert: vi.fn(() => ({ values })),
      update: vi.fn(() => {
        throw new Error("update should not be called on inserted rows");
      }),
    });
    const writer = createResearchWriter(db);
    const input: FindingInput = {
      researchCycleId: 1n,
      cortex: ResearchCortex.Catalog,
      findingType: ResearchFindingType.Insight,
      status: ResearchStatus.Active,
      title: "Inserted finding",
      summary: "Inserted summary",
      evidence: [],
      confidence: 0.8,
      impactScore: 4,
      embedding: null,
      dedupHash: "dedup",
    };

    await expect(writer.upsertFindingByDedupHash(input)).resolves.toEqual({
      row,
      inserted: true,
    });

    expect(values).toHaveBeenCalledWith(input);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("given a deduped finding DTO and an insert conflict, when upsertFindingByDedupHash runs, then it updates the existing row", async () => {
    const row = { id: 202n, title: "Updated finding" };
    const insertReturning = vi.fn(() => Promise.resolve([]));
    const onConflictDoNothing = vi.fn(() => ({ returning: insertReturning }));
    const insertValues = vi.fn(() => ({ onConflictDoNothing }));
    const updateReturning = vi.fn(() => Promise.resolve([row]));
    const where = vi.fn(() => ({ returning: updateReturning }));
    const set = vi.fn(() => ({ where }));
    const db = makeDb({
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set })),
    });
    const writer = createResearchWriter(db);
    const input: FindingInput = {
      researchCycleId: 1n,
      cortex: ResearchCortex.Catalog,
      findingType: ResearchFindingType.Insight,
      status: ResearchStatus.Active,
      title: "Updated finding",
      summary: "Updated summary",
      evidence: [{ source: "test", data: {}, weight: 1 }],
      confidence: 0.9,
      impactScore: 5,
      embedding: null,
      dedupHash: "dedup",
    };

    await expect(writer.upsertFindingByDedupHash(input)).resolves.toEqual({
      row,
      inserted: false,
    });

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        confidence: 0.9,
        evidence: input.evidence,
        summary: "Updated summary",
        embedding: null,
        status: ResearchStatus.Active,
      }),
    );
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("given a cycle finding link, when linkFindingToCycle runs twice, then it reports whether the idempotent insert created a junction row", async () => {
    const returning = vi
      .fn()
      .mockResolvedValueOnce([{ researchFindingId: 101n }])
      .mockResolvedValueOnce([]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const db = makeDb({
      insert: vi.fn(() => ({ values })),
    });
    const writer = createResearchWriter(db);
    const input: LinkInput = {
      cycleId: 1n,
      findingId: 101n,
      iteration: 0,
      isDedupHit: false,
    };

    await expect(writer.linkFindingToCycle(input)).resolves.toBe(true);
    await expect(writer.linkFindingToCycle(input)).resolves.toBe(false);

    expect(values).toHaveBeenCalledWith({
      researchCycleId: 1n,
      researchFindingId: 101n,
      iteration: 0,
      isDedupHit: false,
    });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi } from "vitest";
import { StatsService } from "../../../src/services/stats.service";
import type { StatsRepository } from "../../../src/repositories/stats.repository";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mockRepo(): StatsRepository {
  return {
    aggregates: vi.fn(),
    findingsByStatus: vi.fn(),
    findingsByCortex: vi.fn(),
  } as unknown as StatsRepository;
}

describe("StatsService.snapshot", () => {
  it("converts counts to numbers and derives kgNodes from satellites + findings", async () => {
    const repo = mockRepo();
    (repo.aggregates as ReturnType<typeof vi.fn>).mockResolvedValue({
      satellites: "12",
      conjunctions: "3",
      findings: "5",
      kg_edges: "9",
      research_cycles: "7",
    });
    (repo.findingsByStatus as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: "active", count: "2" },
      { status: "archived", count: 1 },
      { status: "invalidated", count: "4" },
      { status: "triaged", count: "3" },
    ]);
    (repo.findingsByCortex as ReturnType<typeof vi.fn>).mockResolvedValue([
      { cortex: "catalog", count: "6" },
      { cortex: "correlation", count: 2 },
    ]);

    const view = await new StatsService(repo).snapshot();

    expect(view).toEqual({
      satellites: 12,
      conjunctions: 3,
      kgNodes: 17,
      kgEdges: 9,
      findings: 5,
      researchCycles: 7,
      byStatus: {
        pending: 2,
        accepted: 1,
        rejected: 4,
        "in-review": 3,
      },
      byCortex: {
        catalog: 6,
        correlation: 2,
      },
    });
  });

  it("fires the three repo reads before awaiting the first result", async () => {
    const repo = mockRepo();
    const agg = deferred({
      satellites: 0,
      conjunctions: 0,
      findings: 0,
      kg_edges: 0,
      research_cycles: 0,
    });
    const byStatus = deferred<Array<{ status: string; count: number }>>([]);
    const byCortex = deferred<Array<{ cortex: string; count: number }>>([]);

    (repo.aggregates as ReturnType<typeof vi.fn>).mockReturnValue(agg.promise);
    (repo.findingsByStatus as ReturnType<typeof vi.fn>).mockReturnValue(byStatus.promise);
    (repo.findingsByCortex as ReturnType<typeof vi.fn>).mockReturnValue(byCortex.promise);

    const pending = new StatsService(repo).snapshot();

    expect(repo.aggregates).toHaveBeenCalledOnce();
    expect(repo.findingsByStatus).toHaveBeenCalledOnce();
    expect(repo.findingsByCortex).toHaveBeenCalledOnce();

    byStatus.resolve([]);
    byCortex.resolve([]);
    agg.resolve({
      satellites: 0,
      conjunctions: 0,
      findings: 0,
      kg_edges: 0,
      research_cycles: 0,
    });

    await expect(pending).resolves.toEqual({
      satellites: 0,
      conjunctions: 0,
      kgNodes: 0,
      kgEdges: 0,
      findings: 0,
      researchCycles: 0,
      byStatus: {},
      byCortex: {},
    });
  });
});

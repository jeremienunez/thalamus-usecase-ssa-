import { describe, expect, it, vi } from "vitest";
import { typedSpy } from "@interview/test-kit";
import type { LlmTransportFactory } from "../../../../../src/services/llm-transport.port";
import {
  ExplorerScout,
  type ScoutInput,
  type ScoutSignalDbPort,
} from "../../../../../src/agent/ssa/explorer/scout";

function input(overrides: Partial<ScoutInput> = {}): ScoutInput {
  return {
    recentFindings: [
      {
        title: "Intelsat 23 replacement cost trend",
        summary: "Operator hinted at new GEO procurement planning.",
        cortex: "replacement_cost_analyst",
      },
    ],
    recentRssTrends: [{ title: "ESA CDM review", sourceName: "ESA Ops" }],
    previousExplorations: [
      { query: "old success", itemsInjected: 3, qualityScore: 0.9 },
      { query: "old failure", itemsInjected: 0, qualityScore: 0 },
    ],
    trackedDomains: ["celestrak.org"],
    ...overrides,
  };
}

function makeLlm(contentOrError: string | Error): LlmTransportFactory {
  const call = typedSpy<(input: string) => Promise<{ content: string; provider: string }>>();
  if (contentOrError instanceof Error) {
    call.mockRejectedValue(contentOrError);
  } else {
    call.mockResolvedValue({ content: contentOrError, provider: "test" });
  }
  return {
    create: vi.fn(() => ({ call })),
  };
}

describe("ExplorerScout.generateQueries", () => {
  it("normalizes, clamps, sorts, and caps the parsed LLM output", async () => {
    const scout = new ExplorerScout({
      llm: makeLlm(
        JSON.stringify([
          { query: "tiny", type: "market", priority: 9, maxDepth: 2 },
          { query: "Query 1 long enough", type: "market", signal: "a", priority: 2, maxDepth: 5 },
          { query: "Query 2 long enough", type: "academic", signal: "b", priority: 11, maxDepth: 0 },
          { query: "Query 3 long enough", type: "bogus", signal: "c", priority: "7", maxDepth: 2 },
          { query: "Query 4 long enough", priority: 4 },
          { query: "Query 5 long enough", priority: 6 },
          { query: "Query 6 long enough", priority: 5 },
          { query: "Query 7 long enough", priority: 8 },
          { query: "Query 8 long enough", priority: 1 },
          { query: "Query 9 long enough", priority: 3 },
        ]),
      ),
    });

    const queries = await scout.generateQueries(input());

    expect(queries).toHaveLength(8);
    expect(queries.map((query) => query.query)).toEqual([
      "Query 2 long enough",
      "Query 7 long enough",
      "Query 3 long enough",
      "Query 5 long enough",
      "Query 6 long enough",
      "Query 4 long enough",
      "Query 9 long enough",
      "Query 1 long enough",
    ]);
    expect(queries[0]).toMatchObject({
      type: "academic",
      priority: 10,
      maxDepth: 1,
    });
    expect(queries[2]).toMatchObject({
      type: "web",
      maxDepth: 2,
    });
  });

  it("falls back to heuristic queries when the LLM transport throws", async () => {
    const scout = new ExplorerScout({
      llm: makeLlm(new Error("transport down")),
    });

    const queries = await scout.generateQueries(input());

    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]?.query).toContain("satellite replacement cost");
  });

  it("falls back when the LLM returns zero parseable queries", async () => {
    const scout = new ExplorerScout({
      llm: makeLlm('{"not":"an array"}'),
    });

    const queries = await scout.generateQueries(input());

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((query) => query.signal.includes("finding:"))).toBe(
      true,
    );
  });
});

describe("ExplorerScout.gatherSignals", () => {
  it("maps DB rows into the scout input shape, including tracked domains", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ title: "Finding A", summary: "summary", cortex: "catalog" }],
      })
      .mockResolvedValueOnce({
        rows: [{ title: "RSS A", sourceName: "CelesTrak" }],
      })
      .mockResolvedValueOnce({
        rows: [
          { query: "old query", itemsInjected: 2, qualityScore: 0.75 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ domain: "celestrak.org" }, { domain: "esa.int" }],
      });
    const db: ScoutSignalDbPort = { execute };

    const signals = await ExplorerScout.gatherSignals(db);

    expect(signals).toEqual({
      recentFindings: [
        { title: "Finding A", summary: "summary", cortex: "catalog" },
      ],
      recentRssTrends: [{ title: "RSS A", sourceName: "CelesTrak" }],
      previousExplorations: [
        { query: "old query", itemsInjected: 2, qualityScore: 0.75 },
      ],
      trackedDomains: ["celestrak.org", "esa.int"],
    });
    expect(execute).toHaveBeenCalledTimes(4);
  });
});

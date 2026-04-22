import { describe, expect, it, vi } from "vitest";
import type { LlmTransportFactory } from "../../../../../src/services/llm-transport.port";
import {
  ExplorerCurator,
  type CuratorArticle,
} from "../../../../../src/agent/ssa/explorer/curator";

function article(
  overrides: Partial<CuratorArticle> = {},
): CuratorArticle {
  return {
    url: "https://example.com/a",
    title: "SSA field note",
    body: "A".repeat(1800),
    entities: {
      noradIds: [],
      cosparIds: [],
      satellites: ["starlink-1234", "intelsat-23", "swot"],
      launchVehicles: ["falcon 9"],
      orbitRegimes: ["leo", "geo"],
      operators: ["spacex", "esa"],
      dataPoints: ["550 km"],
      hasSatelliteContent: true,
    },
    dataPoints: ["550 km", "12 days"],
    sourceQuery: "query-a",
    depth: 0,
    ...overrides,
  };
}

function llmReturning(contentOrError: string | Error): LlmTransportFactory {
  return {
    create: vi.fn(() => ({
      call:
        contentOrError instanceof Error
          ? vi.fn().mockRejectedValue(contentOrError)
          : vi.fn().mockResolvedValue({
              content: contentOrError,
              provider: "test",
            }),
    })),
  };
}

describe("ExplorerCurator.curate", () => {
  it("returns an empty array for empty input", async () => {
    const curator = new ExplorerCurator({
      llm: llmReturning("[]"),
    });

    await expect(curator.curate([])).resolves.toEqual([]);
  });

  it("scores multi-batch input by calling the LLM once per 10 articles", async () => {
    const call = vi.fn().mockResolvedValue({
      content: JSON.stringify(
        Array.from({ length: 10 }, (_, index) => ({
          relevanceScore: 0.8,
          noveltyScore: 0.7,
          action: "inject",
          category: "DISCOVERY",
          reason: `score-${index}`,
        })),
      ),
      provider: "test",
    });
    const curator = new ExplorerCurator({
      llm: {
        create: vi.fn(() => ({ call })),
      },
    });

    const result = await curator.curate(
      Array.from({ length: 11 }, (_, index) =>
        article({
          url: `https://example.com/${index}`,
          title: `Article ${index}`,
        }),
      ),
    );

    expect(call).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(11);
  });

  it("clamps score values and defaults missing rows to discard", async () => {
    const curator = new ExplorerCurator({
      llm: llmReturning(
        JSON.stringify([
          {
            relevanceScore: 2,
            noveltyScore: -1,
            action: "bogus",
            category: "invalid",
            reason: "x".repeat(250),
          },
        ]),
      ),
    });

    const result = await curator.curate([
      article({ url: "https://example.com/1" }),
      article({ url: "https://example.com/2" }),
    ]);

    expect(result[0]).toMatchObject({
      relevanceScore: 1,
      noveltyScore: 0,
      action: "discard",
      category: "DISCOVERY",
    });
    expect(result[0]?.reason.length).toBe(200);
    expect(result[1]).toMatchObject({
      action: "discard",
      reason: "No score returned",
    });
  });

  it("falls back to heuristic scoring when the LLM call fails", async () => {
    const curator = new ExplorerCurator({
      llm: llmReturning(new Error("rate limited")),
    });

    const [result] = await curator.curate([article()]);

    expect(result).toMatchObject({
      action: "promote",
      category: "DISCOVERY",
    });
    expect(result.reason).toContain("Heuristic:");
  });

  it("derives real inject, promote, and discard actions from article content", async () => {
    const curator = new ExplorerCurator({
      llm: llmReturning(new Error("offline")),
    });

    const results = await curator.curate([
      article({
        url: "https://example.com/promote",
        title: "Detailed SSA dossier",
      }),
      article({
        url: "https://example.com/inject",
        title: "Launch market advisory",
        body: `${"B".repeat(900)} launch contract market insurance`,
        entities: {
          noradIds: [],
          cosparIds: [],
          satellites: ["swot", "terra"],
          launchVehicles: [],
          orbitRegimes: ["geo"],
          operators: [],
          dataPoints: [],
          hasSatelliteContent: true,
        },
        dataPoints: ["800 kg"],
      }),
      article({
        url: "https://example.com/discard",
        title: "General finance note",
        body: "Short wrap with no space content.",
        entities: {
          noradIds: [],
          cosparIds: [],
          satellites: [],
          launchVehicles: [],
          orbitRegimes: [],
          operators: [],
          dataPoints: [],
          hasSatelliteContent: false,
        },
        dataPoints: [],
      }),
    ]);

    expect(results.map((result) => result.action)).toEqual([
      "promote",
      "inject",
      "discard",
    ]);
    expect(results.map((result) => result.category)).toEqual([
      "DISCOVERY",
      "MARKET",
      "DISCOVERY",
    ]);
  });
});

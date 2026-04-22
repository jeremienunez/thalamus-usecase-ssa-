import { describe, expect, it, vi } from "vitest";
import { typedSpy } from "@interview/test-kit";
import type { NanoArticle, SwarmStats } from "@interview/thalamus";
import type { ExplorationQuery, ScoutInput } from "../../../../../src/agent/ssa/explorer/scout";
import type {
  CuratedItem,
  CuratorArticle,
} from "../../../../../src/agent/ssa/explorer/curator";
import type { CrawledArticle } from "../../../../../src/agent/ssa/explorer/crawler";
import {
  ExplorerOrchestrator,
  type ExplorationLogWriterPort,
  type ExplorerOrchestratorDbPort,
  type ExplorerSourceOps,
} from "../../../../../src/agent/ssa/explorer/orchestrator";

function signals(): ScoutInput {
  return {
    recentFindings: [],
    recentRssTrends: [],
    previousExplorations: [],
    trackedDomains: [],
  };
}

function query(overrides: Partial<ExplorationQuery> = {}): ExplorationQuery {
  return {
    query: "starlink conjunction analysis",
    type: "web",
    signal: "finding",
    priority: 8,
    maxDepth: 1,
    ...overrides,
  };
}

function article(
  overrides: Partial<CrawledArticle> = {},
): CrawledArticle {
  return {
    url: "https://example.com/a",
    title: "Article A",
    body: "Body",
    entities: {
      noradIds: [],
      cosparIds: [],
      satellites: ["starlink-1234"],
      launchVehicles: [],
      orbitRegimes: ["leo"],
      operators: ["spacex"],
      dataPoints: [],
      hasSatelliteContent: true,
    },
    dataPoints: [],
    sourceQuery: "starlink conjunction analysis",
    depth: 0,
    ...overrides,
  };
}

function swarmArticle(
  overrides: Partial<NanoArticle> = {},
): NanoArticle {
  return {
    url: "https://example.com/swarm",
    title: "Swarm article",
    body: "Body",
    entities: {
      satellites: ["starlink-1234"],
      operators: ["spacex"],
      orbitRegimes: ["leo"],
      hasSatelliteContent: true,
      noradIds: [],
      cosparIds: [],
      launchVehicles: [],
      dataPoints: [],
    },
    dataPoints: [],
    sourceQuery: "starlink conjunction analysis",
    depth: 0,
    ...overrides,
  };
}

function curated(
  overrides: Partial<CuratedItem> = {},
): CuratedItem {
  return {
    url: "https://example.com/a",
    title: "Curated",
    body: "Body",
    relevanceScore: 0.9,
    noveltyScore: 0.7,
    action: "inject",
    category: "DISCOVERY",
    reason: "Looks useful",
    entities: article().entities,
    ...overrides,
  };
}

function swarmStats(): SwarmStats {
  return {
    totalCalls: 4,
    successCalls: 3,
    failedCalls: 1,
    wallTimeMs: 250,
    uniqueDomains: 2,
    totalUrls: 3,
    totalChars: 1200,
    estimatedCost: 0.0012,
  };
}

function buildSubject() {
  const db: ExplorerOrchestratorDbPort = {
    execute: async <T extends Record<string, unknown> = Record<string, unknown>>() => ({
      rows: [] as T[],
      rowCount: 0,
    }),
  };
  const explorationRepo: ExplorationLogWriterPort = {
    create: typedSpy<ExplorationLogWriterPort["create"]>().mockResolvedValue(
      undefined,
    ),
  };
  const gatherSignals = vi.fn(async () => signals());
  const scout = {
    generateQueries: typedSpy<(input: ScoutInput) => Promise<ExplorationQuery[]>>(),
  };
  const nanoSwarm = {
    crawl: typedSpy<(queries: ExplorationQuery[]) => Promise<{
      articles: NanoArticle[];
      urlsCrawled: number;
      stats: SwarmStats;
    }>>(),
  };
  const crawler = {
    crawl: typedSpy<(queries: ExplorationQuery[]) => Promise<{
      articles: CrawledArticle[];
      urlsCrawled: number;
    }>>(),
  };
  const curatorPort = {
    curate: typedSpy<(articles: CuratorArticle[]) => Promise<CuratedItem[]>>(),
  };
  const sourceOps: ExplorerSourceOps = {
    getOrCreateExplorerSource: vi.fn(async (): Promise<bigint> => 99n),
    injectFeedItem: vi.fn(async (): Promise<void> => undefined),
    promoteToPermanentSource: vi.fn(async (): Promise<boolean> => true),
  };

  const subject = new ExplorerOrchestrator(db, explorationRepo, {
    gatherSignals,
    scout,
    nanoSwarm,
    crawler,
    curator: curatorPort,
    sourceOps,
  });

  return {
    subject,
    explorationRepo,
    gatherSignals,
    scout,
    nanoSwarm,
    crawler,
    curatorPort,
    sourceOps,
  };
}

describe("ExplorerOrchestrator.explore", () => {
  it("short-circuits cleanly when the scout produces zero queries", async () => {
    const ctx = buildSubject();
    ctx.scout.generateQueries.mockResolvedValue([]);

    const result = await ctx.subject.explore();

    expect(result).toEqual({
      queriesGenerated: 0,
      urlsCrawled: 0,
      articlesScraped: 0,
      itemsInjected: 0,
      itemsPromoted: 0,
      avgQuality: 0,
    });
    expect(ctx.nanoSwarm.crawl).not.toHaveBeenCalled();
    expect(ctx.crawler.crawl).not.toHaveBeenCalled();
    expect(ctx.explorationRepo.create).not.toHaveBeenCalled();
  });

  it("falls back to the crawler when the swarm returns zero articles", async () => {
    const ctx = buildSubject();
    ctx.scout.generateQueries.mockResolvedValue([query()]);
    ctx.nanoSwarm.crawl.mockResolvedValue({
      articles: [],
      urlsCrawled: 0,
      stats: swarmStats(),
    });
    ctx.crawler.crawl.mockResolvedValue({
      articles: [article()],
      urlsCrawled: 1,
    });
    ctx.curatorPort.curate.mockResolvedValue([
      curated({ action: "discard", relevanceScore: 0.2 }),
    ]);

    const result = await ctx.subject.explore();

    expect(ctx.crawler.crawl).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      queriesGenerated: 1,
      urlsCrawled: 1,
      articlesScraped: 1,
      itemsInjected: 0,
      itemsPromoted: 0,
      avgQuality: 0.2,
    });
  });

  it("falls back to the crawler when the swarm throws", async () => {
    const ctx = buildSubject();
    ctx.scout.generateQueries.mockResolvedValue([query()]);
    ctx.nanoSwarm.crawl.mockRejectedValue(new Error("nano down"));
    ctx.crawler.crawl.mockResolvedValue({
      articles: [article({ url: "https://example.com/fallback" })],
      urlsCrawled: 1,
    });
    ctx.curatorPort.curate.mockResolvedValue([
      curated({
        url: "https://example.com/fallback",
        action: "discard",
        relevanceScore: 0.4,
      }),
    ]);

    const result = await ctx.subject.explore();

    expect(ctx.crawler.crawl).toHaveBeenCalledOnce();
    expect(result.urlsCrawled).toBe(1);
    expect(result.articlesScraped).toBe(1);
  });

  it("logs zero-result queries when both swarm and crawler find nothing", async () => {
    const ctx = buildSubject();
    ctx.scout.generateQueries.mockResolvedValue([
      query({ query: "q1" }),
      query({ query: "q2", priority: 6 }),
    ]);
    ctx.nanoSwarm.crawl.mockResolvedValue({
      articles: [],
      urlsCrawled: 0,
      stats: swarmStats(),
    });
    ctx.crawler.crawl.mockResolvedValue({
      articles: [],
      urlsCrawled: 0,
    });

    const result = await ctx.subject.explore();

    expect(result).toEqual({
      queriesGenerated: 2,
      urlsCrawled: 0,
      articlesScraped: 0,
      itemsInjected: 0,
      itemsPromoted: 0,
      avgQuality: 0,
    });
    expect(ctx.explorationRepo.create).toHaveBeenCalledTimes(2);
    expect(ctx.explorationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "q1",
        urlsCrawled: 0,
        itemsInjected: 0,
        itemsPromoted: 0,
        qualityScore: 0,
      }),
    );
  });

  it("aggregates inject/promote/logging while tolerating individual write failures", async () => {
    const ctx = buildSubject();
    ctx.scout.generateQueries.mockResolvedValue([query()]);
    ctx.nanoSwarm.crawl.mockResolvedValue({
      articles: [
        swarmArticle({ url: "https://example.com/one" }),
        swarmArticle({ url: "https://example.com/two" }),
        swarmArticle({ url: "https://example.com/three" }),
      ],
      urlsCrawled: 3,
      stats: swarmStats(),
    });
    ctx.curatorPort.curate.mockResolvedValue([
      curated({
        url: "https://example.com/one",
        action: "inject",
        relevanceScore: 0.91,
      }),
      curated({
        url: "https://example.com/two",
        action: "promote",
        relevanceScore: 0.71,
      }),
      curated({
        url: "https://example.com/three",
        action: "promote",
        relevanceScore: 0.58,
      }),
    ]);
    vi.mocked(ctx.sourceOps.injectFeedItem)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("duplicate"));
    vi.mocked(ctx.sourceOps.promoteToPermanentSource)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("domain parse"));

    const result = await ctx.subject.explore();

    expect(result).toMatchObject({
      queriesGenerated: 1,
      urlsCrawled: 3,
      articlesScraped: 3,
      itemsInjected: 2,
      itemsPromoted: 1,
      avgQuality: 0.73,
      swarmStats: swarmStats(),
    });
    expect(ctx.sourceOps.injectFeedItem).toHaveBeenCalledTimes(3);
    expect(ctx.sourceOps.promoteToPermanentSource).toHaveBeenCalledTimes(2);
    expect(ctx.explorationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "starlink conjunction analysis",
        urlsCrawled: 3,
        itemsInjected: 3,
        itemsPromoted: 2,
        qualityScore: expect.closeTo((0.91 + 0.71 + 0.58) / 3, 5),
      }),
    );
  });
});

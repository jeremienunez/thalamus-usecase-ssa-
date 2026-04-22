import { describe, expect, it, vi } from "vitest";
import {
  ExplorerCrawler,
  type CrawledArticle,
} from "../../../../../src/agent/ssa/explorer/crawler";
import type { ExplorationQuery } from "../../../../../src/agent/ssa/explorer/scout";

function query(
  overrides: Partial<ExplorationQuery> = {},
): ExplorationQuery {
  return {
    query: "starlink conjunction analysis",
    type: "web",
    signal: "finding",
    priority: 5,
    maxDepth: 1,
    ...overrides,
  };
}

function scrapedArticle(
  overrides: Partial<CrawledArticle> = {},
): CrawledArticle {
  return {
    url: "https://example.com/article",
    title: "Article",
    body: "Starlink-1234 reached 550 km under SpaceX operations.",
    entities: {
      noradIds: [],
      cosparIds: [],
      satellites: ["starlink-1234"],
      launchVehicles: [],
      orbitRegimes: [],
      operators: ["spacex"],
      dataPoints: ["550 km"],
      hasSatelliteContent: true,
    },
    dataPoints: ["550 km"],
    sourceQuery: "starlink conjunction analysis",
    depth: 0,
    ...overrides,
  };
}

describe("ExplorerCrawler.crawl", () => {
  it("prefers direct web-search content and skips google/scrape fallback", async () => {
    const googleScrapeSearch = vi.fn();
    const scrapeUrl = vi.fn();
    const crawler = new ExplorerCrawler({
      webSearchWithContent: async () => [
        {
          url: "https://esa.int/cdm",
          title: "ESA conjunction review",
          body: "Starlink-1234 by SpaceX remains at 550 km for 12 days.",
        },
      ],
      googleScrapeSearch,
      scrapeUrl,
    });

    const result = await crawler.crawl([query()]);

    expect(result.urlsCrawled).toBe(1);
    expect(result.articles[0]).toMatchObject({
      url: "https://esa.int/cdm",
      title: "ESA conjunction review",
      entities: {
        satellites: ["starlink-1234"],
        operators: ["spacex"],
      },
    });
    expect(result.articles[0]?.dataPoints).toEqual(
      expect.arrayContaining(["550 km", "12 days"]),
    );
    expect(googleScrapeSearch).not.toHaveBeenCalled();
    expect(scrapeUrl).not.toHaveBeenCalled();
  });

  it("falls back to google/scrape when web search returns no content", async () => {
    const googleScrapeSearch = vi.fn(async () => [
      "https://example.com/a",
      "https://example.com/b",
    ]);
    const scrapeUrl = vi
      .fn()
      .mockResolvedValueOnce(scrapedArticle({ url: "https://example.com/a" }))
      .mockResolvedValueOnce(null);
    const crawler = new ExplorerCrawler({
      webSearchWithContent: async () => [],
      googleScrapeSearch,
      scrapeUrl,
    });

    const result = await crawler.crawl([query()]);

    expect(googleScrapeSearch).toHaveBeenCalledOnce();
    expect(scrapeUrl).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      articles: [scrapedArticle({ url: "https://example.com/a" })],
      urlsCrawled: 1,
    });
  });

  it("deduplicates URLs across query results", async () => {
    const crawler = new ExplorerCrawler({
      webSearchWithContent: async (searchQuery) => [
        {
          url: "https://example.com/shared",
          title: `Shared ${searchQuery}`,
          body: "SpaceX moved Starlink-1234 to 550 km.",
        },
      ],
    });

    const result = await crawler.crawl([
      query({ query: "first", priority: 8 }),
      query({ query: "second", priority: 7 }),
    ]);

    expect(result.urlsCrawled).toBe(1);
    expect(result.articles).toHaveLength(1);
  });

  it("keeps later queries alive when one query path throws", async () => {
    const crawler = new ExplorerCrawler({
      webSearchWithContent: async (searchQuery) => {
        if (searchQuery === "first") {
          throw new Error("search failed");
        }
        return [
          {
            url: "https://example.com/ok",
            title: "Recovered article",
            body: "SpaceX moved Starlink-1234 to 550 km.",
          },
        ];
      },
    });

    const result = await crawler.crawl([
      query({ query: "first", priority: 8 }),
      query({ query: "second", priority: 7 }),
    ]);

    expect(result.urlsCrawled).toBe(1);
    expect(result.articles[0]?.url).toBe("https://example.com/ok");
  });
});

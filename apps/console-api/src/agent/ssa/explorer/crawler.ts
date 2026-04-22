import { CheerioCrawler, type CheerioCrawlerOptions } from "crawlee";
import { createLogger } from "@interview/shared/observability";
import { validateExternalUrl } from "@interview/shared";
import {
  extractSatelliteEntities,
  DATA_POINT_RE,
  type SatelliteEntities,
} from "./satellite-entity-patterns";
import type { ExplorationQuery } from "./scout";

const logger = createLogger("explorer-crawler");

const MAX_URLS_PER_CYCLE = 50;
const CYCLE_TIMEOUT_MS = 5 * 60 * 1000;
const PAGE_TIMEOUT_MS = 15_000;

function extractDataPoints(text: string): string[] {
  const dpRe = new RegExp(DATA_POINT_RE.source, DATA_POINT_RE.flags);
  const dataPoints: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = dpRe.exec(text)) !== null) {
    dataPoints.push(match[0]);
  }
  return dataPoints;
}

export interface CrawledArticle {
  url: string;
  title: string;
  body: string;
  entities: SatelliteEntities;
  dataPoints: string[];
  sourceQuery: string;
  depth: number;
}

export interface SearchArticle {
  url: string;
  title: string;
  body: string;
}

export interface ExplorerCrawlerDeps {
  webSearchWithContent?: (query: string) => Promise<SearchArticle[]>;
  googleScrapeSearch?: (query: string) => Promise<string[]>;
  scrapeUrl?: (
    url: string,
    sourceQuery: string,
    depth: number,
  ) => Promise<CrawledArticle | null>;
}

export class ExplorerCrawler {
  private readonly webSearchWithContentImpl: (
    query: string,
  ) => Promise<SearchArticle[]>;
  private readonly googleScrapeSearchImpl: (query: string) => Promise<string[]>;
  private readonly scrapeUrlImpl: (
    url: string,
    sourceQuery: string,
    depth: number,
  ) => Promise<CrawledArticle | null>;

  constructor(deps: ExplorerCrawlerDeps = {}) {
    this.webSearchWithContentImpl =
      deps.webSearchWithContent ?? this.webSearchWithContent.bind(this);
    this.googleScrapeSearchImpl =
      deps.googleScrapeSearch ?? this.googleScrapeSearch.bind(this);
    this.scrapeUrlImpl = deps.scrapeUrl ?? this.scrapeUrl.bind(this);
  }

  async crawl(queries: ExplorationQuery[]): Promise<{
    articles: CrawledArticle[];
    urlsCrawled: number;
  }> {
    const articles: CrawledArticle[] = [];
    let urlsCrawled = 0;
    const startTime = Date.now();
    const seenUrls = new Set<string>();

    const sortedQueries = queries
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 6);

    for (const query of sortedQueries) {
      if (
        Date.now() - startTime > CYCLE_TIMEOUT_MS ||
        urlsCrawled >= MAX_URLS_PER_CYCLE
      )
        break;

      try {
        // Strategy 1: OpenAI web search — get content + URLs directly (no scraping needed)
        const searchResults = await this.webSearchWithContentImpl(query.query);

        if (searchResults.length > 0) {
          for (const sr of searchResults) {
            if (seenUrls.has(sr.url) || urlsCrawled >= MAX_URLS_PER_CYCLE)
              continue;
            seenUrls.add(sr.url);

            const entities = extractSatelliteEntities(sr.body);
            const dataPoints = extractDataPoints(sr.body);

            articles.push({
              url: sr.url,
              title: sr.title,
              body: sr.body.slice(0, 3000),
              entities,
              dataPoints,
              sourceQuery: query.query,
              depth: 0,
            });
            urlsCrawled++;

            logger.info(
              {
                url: sr.url.slice(0, 60),
                title: sr.title.slice(0, 50),
                bodyLen: sr.body.length,
                entities:
                  entities.satellites.length + entities.operators.length,
                source: "openai_web_search",
              },
              "Article from web search",
            );
          }
          continue; // OpenAI gave content, skip Cheerio
        }

        // Strategy 2: Google scrape + CheerioCrawler fallback
        const urls = await this.googleScrapeSearchImpl(query.query);
        logger.info(
          { query: query.query.slice(0, 50), urlCount: urls.length },
          "Google fallback",
        );

        for (const url of urls) {
          if (seenUrls.has(url) || urlsCrawled >= MAX_URLS_PER_CYCLE) continue;
          seenUrls.add(url);

          try {
            const article = await this.scrapeUrlImpl(url, query.query, 0);
            if (article) {
              articles.push(article);
              urlsCrawled++;
              logger.info(
                {
                  url: url.slice(0, 60),
                  bodyLen: article.body.length,
                  source: "cheerio",
                },
                "Article scraped",
              );
            }
          } catch (err) {
            logger.debug({ url: url.slice(0, 60) }, "Scrape failed");
          }
        }
      } catch (err) {
        logger.debug({ query: query.query, err }, "Query exploration failed");
      }
    }

    logger.info(
      { articles: articles.length, urlsCrawled, queries: sortedQueries.length },
      "Crawler cycle complete",
    );

    return { articles, urlsCrawled };
  }

  /**
   * OpenAI web search that returns content + source URLs.
   * Much better than scraping: OpenAI already parsed the pages.
   */
  private async webSearchWithContent(
    query: string,
  ): Promise<SearchArticle[]> {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return [];

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          tools: [{ type: "web_search_preview" }],
          input: `Search for: ${query.slice(0, 200)}

For each relevant result, provide:
1. The source URL
2. The article title
3. A detailed summary (300-500 words) with key facts, numbers, names

Focus on space situational awareness: satellite operators, orbital regimes, conjunctions, maneuvers, launches, debris events, TLE/ephemeris updates, radar tracking. Return at least 3 sources.`,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        logger.debug(
          { status: response.status },
          "OpenAI web search HTTP error",
        );
        return [];
      }

      const data = (await response.json()) as Record<string, any>;

      // Extract the full text content + all cited URLs
      const allUrls: string[] = [];
      let fullText = "";

      for (const output of data.output ?? []) {
        if (output.type === "message") {
          for (const content of output.content ?? []) {
            fullText += (content.text ?? "") + "\n";
            for (const ann of content.annotations ?? []) {
              if (ann.url) allUrls.push(ann.url);
            }
          }
        }
      }

      if (!fullText || fullText.length < 100) return [];

      // Build articles from cited URLs with surrounding text
      const uniqueUrls = [...new Set(allUrls)]
        .filter((u) => !u.includes("google.com/search"))
        .slice(0, 6);

      if (uniqueUrls.length === 0) {
        // No URLs but we have content — create a single article
        return [
          {
            url: `web-search://${query.slice(0, 30).replace(/\s+/g, "-")}`,
            title: query.slice(0, 100),
            body: fullText.slice(0, 3000),
          },
        ];
      }

      // Split the text into per-source chunks (approximate)
      // Simple approach: one article per URL with full context
      const results = uniqueUrls.map((url) => {
        const domain = new URL(url).hostname.replace("www.", "");
        // Find text mentioning this domain
        const domainMentions = fullText
          .split("\n")
          .filter((line) => line.toLowerCase().includes(domain.split(".")[0]))
          .join(" ");

        return {
          url,
          title: `${domain}: ${query.slice(0, 60)}`,
          body:
            domainMentions.length > 50
              ? domainMentions.slice(0, 3000)
              : fullText.slice(0, 2000),
        };
      });

      logger.info(
        {
          query: query.slice(0, 50),
          articles: results.length,
          textLen: fullText.length,
        },
        "OpenAI web search with content",
      );

      return results;
    } catch (err) {
      logger.debug({ query, err }, "OpenAI web search with content failed");
      return [];
    }
  }

  private async openaiWebSearch(query: string): Promise<string[]> {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return [];

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          tools: [{ type: "web_search_preview" }],
          input: `Search for: ${query.slice(0, 200)}. Return the most relevant URLs. Focus on space situational awareness, satellite operations, and orbital traffic analysis.`,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        logger.debug(
          { status: response.status },
          "OpenAI web search HTTP error",
        );
        return [];
      }

      const data = (await response.json()) as Record<string, any>;

      // Extract URLs from web_search_call results (annotations)
      const allUrls: string[] = [];
      for (const output of data.output ?? []) {
        // From message annotations (inline citations)
        if (output.type === "message") {
          for (const content of output.content ?? []) {
            for (const ann of content.annotations ?? []) {
              if (ann.url) allUrls.push(ann.url);
            }
            // Also extract from text body
            const urlPattern = /https?:\/\/[^\s"'<>)\]]+/g;
            const textUrls = (content.text ?? "").match(urlPattern) ?? [];
            allUrls.push(...textUrls);
          }
        }
      }

      const unique = [...new Set(allUrls)]
        .filter((u) => !u.includes("google.com/search")) // skip google result pages
        .slice(0, 8);

      logger.debug(
        { query: query.slice(0, 60), urls: unique.length },
        "OpenAI web search results",
      );
      return unique;
    } catch (err) {
      logger.debug({ query, err }, "OpenAI web search failed");
      return [];
    }
  }

  /**
   * Direct Google search scrape fallback — no API key needed.
   * Extracts URLs from Google search result page.
   */
  private async googleScrapeSearch(query: string): Promise<string[]> {
    try {
      const encoded = encodeURIComponent(query.slice(0, 200));
      const response = await fetch(
        `https://www.google.com/search?q=${encoded}&num=10&hl=en`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!response.ok) {
        logger.debug({ status: response.status }, "Google scrape failed");
        return [];
      }

      const html = await response.text();

      // Extract URLs from Google result links
      // Google wraps results in <a href="/url?q=ACTUAL_URL&...">
      const googleUrlPattern = /\/url\?q=(https?:\/\/[^&"]+)/g;
      const urls: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = googleUrlPattern.exec(html)) !== null) {
        const url = decodeURIComponent(m[1]);
        if (
          !url.includes("google.com") &&
          !url.includes("youtube.com") &&
          !url.includes("webcache.") &&
          !url.includes("translate.google")
        ) {
          urls.push(url);
        }
      }

      const unique = [...new Set(urls)].slice(0, 8);
      logger.debug(
        { query: query.slice(0, 60), urls: unique.length },
        "Google scrape search results",
      );
      return unique;
    } catch (err) {
      logger.debug({ query, err }, "Google scrape search failed");
      return [];
    }
  }

  private async scrapeUrl(
    url: string,
    sourceQuery: string,
    depth: number,
  ): Promise<CrawledArticle | null> {
    // SSRF guard: reject private/internal URLs before crawling
    try {
      validateExternalUrl(url);
    } catch {
      logger.debug({ url: url.slice(0, 60) }, "SSRF guard blocked URL");
      return null;
    }

    return new Promise((resolve) => {
      let result: CrawledArticle | null = null;
      const timeout = setTimeout(() => resolve(null), PAGE_TIMEOUT_MS);

      const crawler = new CheerioCrawler({
        maxRequestsPerCrawl: 1,
        maxConcurrency: 1,
        requestHandlerTimeoutSecs: 12,
        async requestHandler({ $, request }) {
          $(
            "script, style, nav, footer, header, aside, .ad, .ads, .cookie, .popup",
          ).remove();

          const title =
            $("h1").first().text().trim() ||
            $("title").text().trim() ||
            "Untitled";
          const body = $("article, main, .content, .post, .entry, body")
            .first()
            .text()
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 5000);

          if (body.length < 100) {
            resolve(null);
            return;
          }

          const entities = extractSatelliteEntities(body);
          const dataPoints = extractDataPoints(body);

          result = {
            url: request.url,
            title,
            body: body.slice(0, 3000),
            entities,
            dataPoints,
            sourceQuery,
            depth,
          };
        },
        failedRequestHandler() {
          resolve(null);
        },
      } satisfies CheerioCrawlerOptions);

      crawler
        .run([url])
        .then(() => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(() => {
          clearTimeout(timeout);
          resolve(null);
        });
    });
  }
}

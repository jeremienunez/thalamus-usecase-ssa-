import {
  createLlmTransport,
  DEFAULT_CURATOR_PROMPT,
} from "@interview/thalamus";
import { extractJsonArray } from "@interview/shared/utils";
import { createLogger } from "@interview/shared/observability";
import type { CrawledArticle } from "./crawler";

const logger = createLogger("explorer-curator");

export interface CuratedItem {
  url: string;
  title: string;
  body: string;
  relevanceScore: number;
  noveltyScore: number;
  action: "inject" | "promote" | "discard";
  category: string;
  reason: string;
  entities: CrawledArticle["entities"];
}

// Domain-specific rubric injected by console-api at container boot.
// Default is agnostic so the package is runnable + testable standalone.
let curatorPrompt: string = DEFAULT_CURATOR_PROMPT;

export function setCuratorPrompt(prompt: string): void {
  curatorPrompt = prompt;
}

export class ExplorerCurator {
  async curate(articles: CrawledArticle[]): Promise<CuratedItem[]> {
    if (articles.length === 0) return [];

    const batches: CrawledArticle[][] = [];
    for (let i = 0; i < articles.length; i += 10) {
      batches.push(articles.slice(i, i + 10));
    }

    const results: CuratedItem[] = [];

    for (const batch of batches) {
      try {
        const scored = await this.scoreBatch(batch);
        results.push(...scored);
      } catch (err) {
        logger.warn(
          { batchSize: batch.length, err },
          "Curator LLM scoring failed, using heuristic fallback",
        );
        results.push(...batch.map((a) => this.heuristicScore(a)));
      }
    }

    const injected = results.filter((r) => r.action === "inject").length;
    const promoted = results.filter((r) => r.action === "promote").length;
    const discarded = results.filter((r) => r.action === "discard").length;

    logger.info(
      { total: results.length, injected, promoted, discarded },
      "Curator scoring complete",
    );

    return results;
  }

  private async scoreBatch(articles: CrawledArticle[]): Promise<CuratedItem[]> {
    const transport = createLlmTransport(curatorPrompt);

    const payload = articles.map((a, i) => ({
      index: i,
      url: a.url,
      title: a.title,
      bodyPreview: a.body.slice(0, 500),
      entities: {
        satellites: a.entities.satellites.slice(0, 5),
        operators: a.entities.operators.slice(0, 5),
        orbitRegimes: a.entities.orbitRegimes.slice(0, 3),
      },
      dataPointCount: a.dataPoints.length,
      hasSatelliteContent: a.entities.hasSatelliteContent,
    }));

    const response = await transport.call(JSON.stringify(payload));
    const scores = this.parseScores(response.content);

    return articles.map((article, i) => {
      const score = scores[i] ?? {
        relevanceScore: 0,
        noveltyScore: 0,
        action: "discard" as const,
        category: "DISCOVERY" as const,
        reason: "No score returned",
      };

      return {
        url: article.url,
        title: article.title,
        body: article.body,
        relevanceScore: score.relevanceScore,
        noveltyScore: score.noveltyScore,
        action: score.action,
        category: score.category,
        reason: score.reason,
        entities: article.entities,
      };
    });
  }

  /**
   * Heuristic scoring when LLM is unavailable.
   * Uses entity count, data points, and body length as proxies.
   */
  private heuristicScore(article: CrawledArticle): CuratedItem {
    const e = article.entities;
    const entityCount =
      e.satellites.length + e.operators.length + e.orbitRegimes.length;
    const hasData = article.dataPoints.length > 0;
    const bodyLen = article.body.length;

    // Relevance: SSA entities + data points + body length
    let relevance = 0;
    if (e.hasSatelliteContent) relevance += 0.4;
    if (entityCount >= 3) relevance += 0.2;
    else if (entityCount >= 1) relevance += 0.1;
    if (hasData) relevance += 0.2;
    if (bodyLen > 500) relevance += 0.1;
    if (bodyLen > 1500) relevance += 0.1;
    relevance = Math.min(1, relevance);

    // Novelty: assume decent for new content
    const novelty = relevance > 0.5 ? 0.6 : 0.3;

    // Action
    let action: "inject" | "promote" | "discard" = "discard";
    if (relevance >= 0.7 && novelty >= 0.5) action = "inject";
    if (relevance >= 0.8 && entityCount >= 5) action = "promote";

    // Category from content
    const text = `${article.title} ${article.body}`.toLowerCase();
    let category: CuratedItem["category"] = "DISCOVERY";
    if (/launch cost|contract|procurement|price|insurance|market|auction/i.test(text))
      category = "MARKET";
    else if (/advisory|assessment|analysis|review|rating|score|report/i.test(text))
      category = "REVIEWS";
    else if (/launch|deployment|first light|commissioning|ioc|new satellite/i.test(text))
      category = "DROPS";

    logger.info(
      {
        url: article.url.slice(0, 50),
        relevance,
        novelty,
        action,
        entityCount,
        dataPoints: article.dataPoints.length,
        hasSat: e.hasSatelliteContent,
        bodyLen: article.body.length,
        satellites: e.satellites.slice(0, 3),
        operators: e.operators.slice(0, 3),
      },
      "Heuristic score",
    );

    return {
      url: article.url,
      title: article.title,
      body: article.body,
      relevanceScore: relevance,
      noveltyScore: novelty,
      action,
      category,
      reason: `Heuristic: ${entityCount} entities, ${article.dataPoints.length} data points, ssa=${e.hasSatelliteContent}`,
      entities: article.entities,
    };
  }

  private parseScores(content: string) {
    const items = extractJsonArray(content);
    return items.map((s: any) => ({
      relevanceScore: Math.max(0, Math.min(1, Number(s.relevanceScore) || 0)),
      noveltyScore: Math.max(0, Math.min(1, Number(s.noveltyScore) || 0)),
      action: (["inject", "promote", "discard"].includes(s.action)
        ? s.action
        : "discard") as "inject" | "promote" | "discard",
      category: (["MARKET", "REVIEWS", "DROPS", "DISCOVERY"].includes(
        s.category,
      )
        ? s.category
        : "DISCOVERY") as "MARKET" | "REVIEWS" | "DROPS" | "DISCOVERY",
      reason: String(s.reason ?? "").slice(0, 200),
    }));
  }
}

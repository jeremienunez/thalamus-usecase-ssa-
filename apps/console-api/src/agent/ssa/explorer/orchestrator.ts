import { createLogger } from "@interview/shared/observability";
import { sql } from "drizzle-orm";
import {
  NanoSwarm,
  type NanoArticle,
  type SwarmStats,
} from "@interview/thalamus";
import {
  ExplorerScout,
  type ExplorationQuery,
  type ScoutInput,
} from "./scout";
import {
  ExplorerCrawler,
  type CrawledArticle,
} from "./crawler";
import {
  ExplorerCurator,
  type CuratedItem,
  type CuratorArticle,
} from "./curator";
import {
  ExplorationRepository,
  type CreateExplorationLogInput,
} from "./exploration.repository";
import type { SatelliteEntities } from "./satellite-entity-patterns";

const logger = createLogger("explorer-orchestrator");

export interface ExplorationResult {
  queriesGenerated: number;
  urlsCrawled: number;
  articlesScraped: number;
  itemsInjected: number;
  itemsPromoted: number;
  avgQuality: number;
  swarmStats?: SwarmStats;
}

export interface ExplorerOrchestratorDbPort {
  execute<T extends Record<string, unknown> = Record<string, unknown>>(
    query: unknown,
  ): Promise<{ rows: T[]; rowCount?: number }>;
}

export interface ExplorationLogWriterPort {
  create(input: CreateExplorationLogInput): Promise<unknown>;
}

export interface ExplorerScoutPort {
  generateQueries(input: ScoutInput): Promise<ExplorationQuery[]>;
}

export interface ExplorerSwarmPort {
  crawl(queries: ExplorationQuery[]): Promise<{
    articles: NanoArticle[];
    urlsCrawled: number;
    stats: SwarmStats;
  }>;
}

export interface ExplorerCrawlerPort {
  crawl(queries: ExplorationQuery[]): Promise<{
    articles: CrawledArticle[];
    urlsCrawled: number;
  }>;
}

export interface ExplorerCuratorPort {
  curate(articles: CuratorArticle[]): Promise<CuratedItem[]>;
}

export interface ExplorerSourceOps {
  getOrCreateExplorerSource(db: ExplorerOrchestratorDbPort): Promise<bigint>;
  injectFeedItem(
    db: ExplorerOrchestratorDbPort,
    item: CuratedItem,
    sourceId: bigint,
  ): Promise<void>;
  promoteToPermanentSource(
    db: ExplorerOrchestratorDbPort,
    item: CuratedItem,
  ): Promise<boolean>;
}

export interface ExplorerOrchestratorDeps {
  gatherSignals?: (db: ExplorerOrchestratorDbPort) => Promise<ScoutInput>;
  scout?: ExplorerScoutPort;
  nanoSwarm?: ExplorerSwarmPort;
  crawler?: ExplorerCrawlerPort;
  curator?: ExplorerCuratorPort;
  sourceOps?: ExplorerSourceOps;
}

const defaultSourceOps: ExplorerSourceOps = {
  async getOrCreateExplorerSource(db) {
    const existing = await db.execute<{ id: string | bigint }>(sql`
      SELECT id FROM source WHERE slug = 'thalamus-explorer' LIMIT 1
    `);

    if (existing.rows.length > 0) {
      return BigInt(existing.rows[0]!.id);
    }

    const result = await db.execute<{ id: string | bigint }>(sql`
      INSERT INTO source (name, slug, kind, url, category, is_enabled)
      VALUES ('Thalamus Explorer', 'thalamus-explorer', 'osint', 'internal://explorer', 'DISCOVERY', true)
      ON CONFLICT (slug) DO UPDATE SET name = 'Thalamus Explorer'
      RETURNING id
    `);

    return BigInt(result.rows[0]!.id);
  },

  async injectFeedItem(db, item, sourceId) {
    const guid = `explorer:${item.url}`;
    await db.execute(sql`
      INSERT INTO source_item (
        source_id, external_id, title, abstract, url,
        raw_metadata, fetched_at
      ) VALUES (
        ${sourceId},
        ${guid},
        ${item.title.slice(0, 500)},
        ${item.body.slice(0, 2000)},
        ${item.url},
        ${JSON.stringify({
          category: "DISCOVERY",
          satellites: item.entities.satellites,
          operators: item.entities.operators,
          orbitRegimes: item.entities.orbitRegimes,
        })}::jsonb,
        now()
      )
      ON CONFLICT (source_id, external_id) DO NOTHING
    `);
  },

  async promoteToPermanentSource(db, item) {
    const domain = new URL(item.url).hostname;
    const slug = `discovered-${domain.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

    const existing = await db.execute(sql`
      SELECT id FROM source WHERE url LIKE ${"%" + domain + "%"} LIMIT 1
    `);

    if (existing.rows.length > 0) return false;

    await db.execute(sql`
      INSERT INTO source (name, slug, kind, url, category, is_enabled)
      VALUES (
        ${`[Discovered] ${domain}`},
        ${slug},
        'osint',
        ${item.url},
        ${item.category ?? "DISCOVERY"},
        true
      )
      ON CONFLICT (slug) DO NOTHING
    `);

    logger.info(
      { domain, category: item.category },
      "Promoted to permanent source",
    );
    return true;
  },
};

function normalizeEntities(value: unknown): SatelliteEntities {
  const entityMap =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const array = (key: string): string[] =>
    Array.isArray(entityMap[key])
      ? entityMap[key].filter((item): item is string => typeof item === "string")
      : [];

  const satellites = array("satellites");
  const operators = array("operators");
  const orbitRegimes = array("orbitRegimes");
  const noradIds = array("noradIds");
  const cosparIds = array("cosparIds");
  const launchVehicles = array("launchVehicles");
  const dataPoints = array("dataPoints");
  const hasSatelliteContent =
    typeof entityMap.hasSatelliteContent === "boolean"
      ? entityMap.hasSatelliteContent
      : noradIds.length > 0 ||
        cosparIds.length > 0 ||
        satellites.length > 0 ||
        operators.length > 0;

  return {
    noradIds,
    cosparIds,
    satellites,
    launchVehicles,
    orbitRegimes,
    operators,
    dataPoints,
    hasSatelliteContent,
  };
}

function toCuratorArticle(article: CrawledArticle | NanoArticle): CuratorArticle {
  return {
    url: article.url,
    title: article.title,
    body: article.body,
    entities: normalizeEntities(article.entities),
    dataPoints: Array.isArray(article.dataPoints) ? article.dataPoints : [],
    sourceQuery: article.sourceQuery,
    depth: article.depth,
  };
}

export class ExplorerOrchestrator {
  private readonly scout: ExplorerScoutPort;
  private readonly crawler: ExplorerCrawlerPort;
  private readonly nanoSwarm: ExplorerSwarmPort;
  private readonly curator: ExplorerCuratorPort;
  private readonly gatherSignals: (
    db: ExplorerOrchestratorDbPort,
  ) => Promise<ScoutInput>;
  private readonly sourceOps: ExplorerSourceOps;

  constructor(
    private readonly db: ExplorerOrchestratorDbPort,
    private readonly explorationRepo:
      | ExplorationRepository
      | ExplorationLogWriterPort,
    deps: ExplorerOrchestratorDeps = {},
  ) {
    this.gatherSignals =
      deps.gatherSignals ?? ((db) => ExplorerScout.gatherSignals(db));
    this.scout = deps.scout ?? new ExplorerScout();
    this.crawler = deps.crawler ?? new ExplorerCrawler();
    this.nanoSwarm = deps.nanoSwarm ?? new NanoSwarm();
    this.curator = deps.curator ?? new ExplorerCurator();
    this.sourceOps = deps.sourceOps ?? defaultSourceOps;
  }

  async explore(): Promise<ExplorationResult> {
    logger.info(">>> [STEP 0] Resource Explorer cycle starting");

    // 1. Scout: gather signals -> generate queries
    logger.info(">>> [STEP 1a] Gathering signals from DB...");
    let signals;
    try {
      signals = await this.gatherSignals(this.db);
      logger.info(
        {
          findings: signals.recentFindings.length,
          rssTrends: signals.recentRssTrends.length,
          prevExplorations: signals.previousExplorations.length,
          trackedDomains: signals.trackedDomains.length,
        },
        ">>> [STEP 1b] Signals gathered",
      );
    } catch (err) {
      logger.error({ err }, ">>> [STEP 1] FAILED gathering signals");
      throw err;
    }

    logger.info(">>> [STEP 2a] Scout generating queries via LLM...");
    let queries;
    try {
      queries = await this.scout.generateQueries(signals);
      logger.info(
        { count: queries.length, queries: queries.map((q) => q.query) },
        ">>> [STEP 2b] Scout queries generated",
      );
    } catch (err) {
      logger.error({ err }, ">>> [STEP 2] FAILED generating queries");
      throw err;
    }

    if (queries.length === 0) {
      logger.info(">>> Scout generated 0 queries, cycle complete");
      return {
        queriesGenerated: 0,
        urlsCrawled: 0,
        articlesScraped: 0,
        itemsInjected: 0,
        itemsPromoted: 0,
        avgQuality: 0,
      };
    }

    // 2. Nano Swarm: decompose queries -> 50 parallel nano researchers -> merge
    logger.info(">>> [STEP 3a] Nano swarm starting...");
    let articles, urlsCrawled;
    let swarmStats: SwarmStats | undefined;
    try {
      const swarmResult = await this.nanoSwarm.crawl(queries);
      articles = swarmResult.articles;
      urlsCrawled = swarmResult.urlsCrawled;
      swarmStats = swarmResult.stats;
      logger.info(
        {
          articles: articles.length,
          urlsCrawled,
          domains: swarmStats.uniqueDomains,
          cost: `$${swarmStats.estimatedCost.toFixed(4)}`,
          wallTime: `${(swarmStats.wallTimeMs / 1000).toFixed(1)}s`,
        },
        ">>> [STEP 3b] Nano swarm done",
      );

      // Fallback to legacy crawler if swarm produced nothing
      if (articles.length === 0) {
        logger.warn(
          "Nano swarm returned 0 articles, falling back to legacy crawler",
        );
        const crawlResult = await this.crawler.crawl(queries);
        articles = crawlResult.articles;
        urlsCrawled = crawlResult.urlsCrawled;
      }
    } catch (err) {
      logger.error(
        { err },
        ">>> [STEP 3] Nano swarm FAILED, falling back to legacy crawler",
      );
      try {
        const crawlResult = await this.crawler.crawl(queries);
        articles = crawlResult.articles;
        urlsCrawled = crawlResult.urlsCrawled;
      } catch (crawlErr) {
        logger.error({ crawlErr }, ">>> [STEP 3] Legacy crawler also FAILED");
        throw crawlErr;
      }
    }

    if (articles.length === 0) {
      logger.info(">>> Crawler found 0 articles, logging + done");
      for (const q of queries) {
        await this.explorationRepo.create({
          query: q.query,
          queryType: q.type,
          signalSource: q.signal,
          urlsCrawled: 0,
          itemsInjected: 0,
          itemsPromoted: 0,
          qualityScore: 0,
          explorationMeta: null,
        });
      }
      return {
        queriesGenerated: queries.length,
        urlsCrawled,
        articlesScraped: 0,
        itemsInjected: 0,
        itemsPromoted: 0,
        avgQuality: 0,
      };
    }

    // 3. Curator: score articles -> decide action.
    // NanoSwarm emits opaque `entities`; normalize them into the SSA article
    // shape the curator expects so tests can use structural fakes without
    // leaning on unsafe casts.
    logger.info(">>> [STEP 4a] Curator scoring articles...");
    const curated = await this.curator.curate(
      articles.map((article) => toCuratorArticle(article)),
    );
    logger.info(
      {
        total: curated.length,
        inject: curated.filter((c) => c.action === "inject").length,
        promote: curated.filter((c) => c.action === "promote").length,
        discard: curated.filter((c) => c.action === "discard").length,
      },
      ">>> [STEP 4b] Curator done",
    );

    // 4. Inject & Promote
    const toInject = curated.filter(
      (c) => c.action === "inject" || c.action === "promote",
    );
    const toPromote = curated.filter((c) => c.action === "promote");

    let itemsInjected = 0;
    let itemsPromoted = 0;

    const explorerSourceId = await this.sourceOps.getOrCreateExplorerSource(
      this.db,
    );

    for (const item of toInject) {
      try {
        await this.sourceOps.injectFeedItem(this.db, item, explorerSourceId);
        itemsInjected++;
      } catch (err) {
        logger.debug({ url: item.url, err }, "Failed to inject feed item");
      }
    }

    for (const item of toPromote) {
      try {
        const promoted = await this.sourceOps.promoteToPermanentSource(
          this.db,
          item,
        );
        if (promoted) itemsPromoted++;
      } catch (err) {
        logger.debug({ url: item.url, err }, "Failed to promote source");
      }
    }

    // 5. Log exploration results
    const avgQuality =
      curated.length > 0
        ? curated.reduce((s, c) => s + c.relevanceScore, 0) / curated.length
        : 0;

    const queryMap = new Map<string, CuratedItem[]>();
    for (const item of curated) {
      const article = articles.find((a) => a.url === item.url);
      const q = article?.sourceQuery ?? "unknown";
      if (!queryMap.has(q)) queryMap.set(q, []);
      queryMap.get(q)!.push(item);
    }

    for (const [queryStr, items] of queryMap) {
      const query = queries.find((q) => q.query === queryStr);
      await this.explorationRepo.create({
        query: queryStr,
        queryType: query?.type ?? "web",
        signalSource: query?.signal ?? null,
        urlsCrawled: items.length,
        itemsInjected: items.filter(
          (i) => i.action === "inject" || i.action === "promote",
        ).length,
        itemsPromoted: items.filter((i) => i.action === "promote").length,
        qualityScore:
          items.reduce((s, i) => s + i.relevanceScore, 0) / items.length,
        explorationMeta: {
          urls: items.map((i) => i.url),
          scores: items.map((i) => ({
            relevance: i.relevanceScore,
            novelty: i.noveltyScore,
            action: i.action,
          })),
        },
      });
    }

    logger.info(">>> [STEP 5] Inject/Promote/Log complete");

    const result: ExplorationResult = {
      queriesGenerated: queries.length,
      urlsCrawled,
      articlesScraped: articles.length,
      itemsInjected,
      itemsPromoted,
      avgQuality: Number(avgQuality.toFixed(2)),
      swarmStats,
    };

    logger.info(result, "Resource Explorer cycle complete");
    return result;
  }
}

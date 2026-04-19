/**
 * Nano Swarm Crawler — generic fan-out/merge web-research executor.
 *
 * Decomposes scout queries into micro-queries across a set of "researcher
 * lenses", runs them in waves, deduplicates URLs, and merges the results
 * into CrawledArticle[]. The domain flavour (lens catalog, keyword map,
 * call instructions) is supplied by a `NanoSwarmProfile` — see
 * `prompts/nano-swarm.prompt.ts`. Consumers inject a domain profile via
 * `setNanoSwarmProfile()` at boot; a minimal generic default keeps the
 * module self-contained for tests.
 *
 * Architecture:
 *   Scout queries -> Decomposer (per-profile) -> micro-queries
 *   -> Wave executor (parallel × N waves, delay between waves)
 *   -> Dedup + merge -> CrawledArticle[]
 */

import { createLogger } from "@interview/shared/observability";
import {
  type ConfigProvider,
  type NanoSwarmConfig,
  DEFAULT_NANO_SWARM_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import { callNanoWithMode } from "./nano-caller";
import type { ExplorationQuery } from "./scout";
import type { CrawledArticle } from "./crawler";
import {
  DEFAULT_NANO_SWARM_PROFILE,
  type Lens,
  type NanoSwarmProfile,
} from "../prompts";

/**
 * Crawler-shaped extraction result produced per crawled body. The
 * `entities` slot is forwarded straight into `CrawledArticle.entities`,
 * so its shape is whatever the domain extractor returns (SSA today,
 * something else tomorrow). Kernel stays agnostic.
 */
export interface CrawlerExtraction {
  entities: CrawledArticle["entities"];
  dataPoints: string[];
}

export type EntityExtractorFn = (text: string) => CrawlerExtraction;

// Domain-specific entity extraction is injected at boot. Default returns
// an empty payload so the kernel stays runnable standalone.
const NOOP_EXTRACTION: CrawlerExtraction = {
  entities: {} as CrawledArticle["entities"],
  dataPoints: [],
};

let entityExtractor: EntityExtractorFn = () => NOOP_EXTRACTION;

export function setEntityExtractor(fn: EntityExtractorFn): void {
  entityExtractor = fn;
}

const logger = createLogger("nano-swarm");

// Runtime-tunable wave config (waveSize / waveDelayMs / maxMicroQueries).
// Defaults mirror the pre-refactor constants; console-api overrides via
// setNanoSwarmConfigProvider() at container boot.
let nanoSwarmConfigProvider: ConfigProvider<NanoSwarmConfig> =
  new StaticConfigProvider(DEFAULT_NANO_SWARM_CONFIG);

export function setNanoSwarmConfigProvider(
  provider: ConfigProvider<NanoSwarmConfig>,
): void {
  nanoSwarmConfigProvider = provider;
}

// Domain profile: lens catalog + pickLenses + prompt builders.
// Console-api injects the SSA profile at boot via setNanoSwarmProfile().
let nanoSwarmProfile: NanoSwarmProfile = DEFAULT_NANO_SWARM_PROFILE;

export function setNanoSwarmProfile(profile: NanoSwarmProfile): void {
  nanoSwarmProfile = profile;
}

// ─── Types ───────────────────────────────────────────────────────────

interface MicroQuery {
  query: string;
  researcherId: string;
  lens: string;
  sourceScoutQuery: string;
}

interface NanoResult {
  researcherId: string;
  ok: boolean;
  latencyMs: number;
  urls: string[];
  text: string;
  sourceQuery: string;
  error?: string;
}

export interface SwarmStats {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  wallTimeMs: number;
  uniqueDomains: number;
  totalUrls: number;
  totalChars: number;
  estimatedCost: number;
}

// ─── Decomposer ──────────────────────────────────────────────────────

/**
 * Takes scout queries and expands them into micro-queries by crossing
 * each query with lenses the profile selects, then filling remaining
 * slots with unused lenses for coverage.
 */
function decompose(
  scoutQueries: ExplorationQuery[],
  maxMicroQueries: number,
  profile: NanoSwarmProfile,
): MicroQuery[] {
  const micros: MicroQuery[] = [];

  // Sort by priority, take top 6 (keeps wave shape bounded)
  const top = scoutQueries.sort((a, b) => b.priority - a.priority).slice(0, 6);
  if (top.length === 0) return [];

  // For each scout query, pick the most relevant lenses via the profile.
  for (const sq of top) {
    const lenses = profile.pickLenses(sq);
    for (const lens of lenses) {
      if (micros.length >= maxMicroQueries) break;
      micros.push(buildMicroQuery(sq, lens));
    }
  }

  // Fill remaining slots with diverse lenses not yet used
  const usedIds = new Set(micros.map((m) => m.researcherId));
  const unused = profile.lenses.filter((l) => !usedIds.has(l.id));

  let qi = 0;
  for (const lens of unused) {
    if (micros.length >= maxMicroQueries) break;
    const sq = top[qi % top.length]!;
    micros.push(buildMicroQuery(sq, lens));
    qi++;
  }

  return micros.slice(0, maxMicroQueries);
}

function buildMicroQuery(sq: ExplorationQuery, lens: Lens): MicroQuery {
  return {
    query: `${sq.query} — focus: ${lens.lens.split(",")[0]}`,
    researcherId: lens.id,
    lens: lens.lens,
    sourceScoutQuery: sq.query,
  };
}

// ─── Nano caller ─────────────────────────────────────────────────────

async function callNano(micro: MicroQuery): Promise<NanoResult> {
  const start = Date.now();
  const res = await callNanoWithMode({
    instructions: nanoSwarmProfile.buildCallInstructions(micro.lens),
    input: nanoSwarmProfile.buildCallInput(micro.query),
    enableWebSearch: true,
  });
  return {
    researcherId: micro.researcherId,
    ok: res.ok,
    latencyMs: res.latencyMs || Date.now() - start,
    urls: res.urls,
    text: res.text,
    sourceQuery: micro.sourceScoutQuery,
    ...(res.error ? { error: res.error } : {}),
  };
}

/**
 * Strip markdown formatting so entity extraction works on clean prose.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/---+/g, "")
    .replace(/\s{2,}/g, " ");
}

/**
 * Normalize URL for dedup: strip utm params, trailing slash, lowercase hostname.
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    for (const p of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "ref",
    ]) {
      u.searchParams.delete(p);
    }
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

// ─── Wave executor ───────────────────────────────────────────────────

async function executeWaves(
  micros: MicroQuery[],
  waveSize: number,
  waveDelayMs: number,
): Promise<NanoResult[]> {
  const allResults: NanoResult[] = [];
  const totalWaves = Math.ceil(micros.length / waveSize);

  for (let w = 0; w < micros.length; w += waveSize) {
    const wave = micros.slice(w, w + waveSize);
    const waveNum = Math.floor(w / waveSize) + 1;

    logger.info(
      { wave: waveNum, total: totalWaves, queries: wave.length },
      "Nano wave starting",
    );

    const results = await Promise.all(wave.map(callNano));
    allResults.push(...results);

    const ok = results.filter((r) => r.ok).length;
    const urls = results.reduce((s, r) => s + r.urls.length, 0);
    logger.info(
      { wave: waveNum, ok, failed: wave.length - ok, urls },
      "Nano wave complete",
    );

    if (w + waveSize < micros.length) {
      await new Promise((r) => setTimeout(r, waveDelayMs));
    }
  }

  return allResults;
}

// ─── Merger & dedup ──────────────────────────────────────────────────

function mergeResults(results: NanoResult[]): {
  articles: CrawledArticle[];
  stats: SwarmStats;
} {
  const successful = results.filter((r) => r.ok && r.text.length > 50);
  const seenUrls = new Set<string>();
  const articles: CrawledArticle[] = [];
  const allDomains = new Set<string>();

  for (const r of successful) {
    const cleanText = stripMarkdown(r.text);

    for (const url of r.urls) {
      const normalizedUrl = normalizeUrl(url);
      if (seenUrls.has(normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);

      let domain: string;
      try {
        domain = new URL(url).hostname.replace("www.", "");
      } catch {
        continue;
      }
      allDomains.add(domain);

      const lines = cleanText
        .split("\n")
        .filter((l: string) => l.trim().length > 10);
      const domainKey = domain.split(".")[0]!;
      const relevantLines = lines.filter((l: string) =>
        l.toLowerCase().includes(domainKey),
      );
      const domainContext = relevantLines.join(" ");
      const body =
        domainContext.length > 100
          ? (domainContext + "\n" + cleanText).slice(0, 3000)
          : cleanText.slice(0, 3000);

      const { entities, dataPoints } = entityExtractor(cleanText);

      const titleLine = lines.find((l: string) =>
        l.toLowerCase().includes(domainKey),
      );
      const title = titleLine
        ? titleLine.replace(/^[-*#\d.)\s]+/, "").slice(0, 120)
        : `${domain}: ${r.sourceQuery.slice(0, 60)}`;

      articles.push({
        url,
        title,
        body,
        entities,
        dataPoints,
        sourceQuery: r.sourceQuery,
        depth: 0,
      });
    }

    if (cleanText.length > 200 && r.urls.length === 0) {
      const { entities, dataPoints } = entityExtractor(cleanText);

      articles.push({
        url: `nano://${r.researcherId}`,
        title: `[${r.researcherId}] ${r.sourceQuery.slice(0, 60)}`,
        body: cleanText.slice(0, 3000),
        entities,
        dataPoints,
        sourceQuery: r.sourceQuery,
        depth: 0,
      });
    }
  }

  const totalChars = successful.reduce((s, r) => s + r.text.length, 0);
  // Rough cost estimate: ~1.5K input + ~0.8K output per call @ nano pricing.
  const estimatedCost =
    (results.length * 1500 * 0.2 + results.length * 800 * 1.25) / 1_000_000;

  const stats: SwarmStats = {
    totalCalls: results.length,
    successCalls: successful.length,
    failedCalls: results.length - successful.length,
    wallTimeMs: 0,
    uniqueDomains: allDomains.size,
    totalUrls: seenUrls.size,
    totalChars,
    estimatedCost,
  };

  return { articles, stats };
}

// ─── Public API ──────────────────────────────────────────────────────

export class NanoSwarm {
  /**
   * Execute a full nano swarm cycle.
   * Takes scout queries, decomposes via the active profile into
   * micro-queries, runs them in waves, merges and deduplicates results.
   */
  async crawl(scoutQueries: ExplorationQuery[]): Promise<{
    articles: CrawledArticle[];
    urlsCrawled: number;
    stats: SwarmStats;
  }> {
    const globalStart = Date.now();
    const cfg = await nanoSwarmConfigProvider.get();

    const micros = decompose(scoutQueries, cfg.maxMicroQueries, nanoSwarmProfile);
    logger.info(
      {
        scoutQueries: scoutQueries.length,
        microQueries: micros.length,
        researchers: [...new Set(micros.map((m) => m.researcherId))].length,
      },
      "Nano swarm decomposed queries",
    );

    const results = await executeWaves(micros, cfg.waveSize, cfg.waveDelayMs);

    const { articles, stats } = mergeResults(results);
    stats.wallTimeMs = Date.now() - globalStart;

    logger.info(
      {
        articles: articles.length,
        urls: stats.totalUrls,
        domains: stats.uniqueDomains,
        wallTime: `${(stats.wallTimeMs / 1000).toFixed(1)}s`,
        cost: `$${stats.estimatedCost.toFixed(4)}`,
        success: `${stats.successCalls}/${stats.totalCalls}`,
      },
      "Nano swarm cycle complete",
    );

    return {
      articles,
      urlsCrawled: stats.totalUrls,
      stats,
    };
  }
}

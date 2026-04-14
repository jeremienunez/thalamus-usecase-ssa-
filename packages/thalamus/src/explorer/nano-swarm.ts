/**
 * Nano Swarm Crawler — "The Constellation"
 *
 * Replaces single gpt-4.1-mini web search calls with a swarm of 50 specialized
 * gpt-5.4-nano researchers, each with a unique angle/skill. Runs in waves of 5
 * with 2s delay to respect rate limits.
 *
 * Architecture:
 *   Scout queries (6-8) → Decomposer (1x nano) → 50 micro-queries
 *   → Wave executor (5 parallel × 10 waves × 2s delay)
 *   → Dedup + merge → CrawledArticle[]
 *
 * Cost: ~$0.05 per cycle (50 calls × ~1.5K in + ~0.8K out)
 * Coverage: 13+ unique domains vs 1-2 with single calls
 * Time: ~90-120s wall clock
 */

import { createLogger } from "@interview/shared/observability";
import {
  extractSatelliteEntities,
  DATA_POINT_RE,
} from "../utils/satellite-entity-patterns";
import type { ExplorationQuery } from "./scout";
import type { CrawledArticle } from "./crawler";

const logger = createLogger("nano-swarm");

// ─── Rate limit config ───────────────────────────────────────────────
const WAVE_SIZE = 5;
const WAVE_DELAY_MS = 2_000;
const CALL_TIMEOUT_MS = 45_000;
const MAX_MICRO_QUERIES = 50;
const NANO_MODEL = "gpt-5.4-nano";

// ─── Researcher specializations ──────────────────────────────────────
// Each nano gets a "lens" that shapes its web search angle
const RESEARCHER_LENSES = [
  // 1-5: Replacement cost & procurement intelligence
  {
    id: "cost-prime-contractor",
    lens: "prime contractor bus pricing, ex-factory cost, procurement contracts",
  },
  {
    id: "cost-launch",
    lens: "launch service auction results, ride-share slot pricing, payload-kg estimates",
  },
  {
    id: "cost-insurance",
    lens: "launch insurance premiums, on-orbit coverage rates, underwriter pricing",
  },
  {
    id: "cost-futures",
    lens: "forward launch manifest pricing, campaign pricing, new-build vs refurbished platforms",
  },
  {
    id: "cost-index",
    lens: "SpaceNews index, commercial space indices, transponder rates, market benchmarks",
  },

  // 6-10: Advisory & assessment tracking
  {
    id: "advisory-18scs",
    lens: "18th SDS conjunction data messages, CSpOC advisories, screening thresholds",
  },
  {
    id: "advisory-leolabs",
    lens: "LeoLabs conjunction assessments, top risk events, regime reports",
  },
  {
    id: "advisory-esa",
    lens: "ESA Space Debris Office assessments, DISCOS records, regime evaluation",
  },
  {
    id: "advisory-aerospace",
    lens: "Aerospace Corp CORDS analyses, reentry panels, regional reports",
  },
  {
    id: "advisory-consensus",
    lens: "advisory consensus, aggregate Pc scores, rating comparisons across providers",
  },

  // 11-15: Market intelligence
  {
    id: "market-brycetech",
    lens: "BryceTech market data, top operators, broker sentiment, bid/ask spreads",
  },
  {
    id: "market-volumes",
    lens: "launch cadence, market liquidity, operator demand, transaction data",
  },
  {
    id: "market-trends",
    lens: "market momentum, capacity appreciation, outperforming orbital regimes",
  },
  {
    id: "market-asia",
    lens: "Asian space market, China India Japan demand, import data, operator trends",
  },
  {
    id: "market-us-eu",
    lens: "US EU launch market, provider pricing, euro dollar space trade",
  },

  // 16-20: Orbital regime & launch-year context
  {
    id: "regime-space-weather",
    lens: "space weather conditions, Kp index, geomagnetic storms, SWPC reports",
  },
  {
    id: "regime-yield",
    lens: "orbit insertion success, deployment quantities, anomaly damage reports",
  },
  {
    id: "regime-structure",
    lens: "orbit regime analysis, debris density studies, surveillance surveys, precision tracking",
  },
  {
    id: "regime-sustainable",
    lens: "sustainable operators, IADC certification, space sustainability",
  },
  {
    id: "regime-innovation",
    lens: "platform innovation, technology adoption, station-keeping techniques",
  },

  // 21-25: Investment analysis
  {
    id: "invest-roi",
    lens: "satellite investment returns, ROI analysis, launch-year comparison, performance",
  },
  {
    id: "invest-undervalued",
    lens: "undervalued satellites, value picks, emerging operator countries, sleeper assets",
  },
  {
    id: "invest-portfolio",
    lens: "fleet strategy, diversification, asset allocation, risk",
  },
  {
    id: "invest-forecast",
    lens: "pricing forecast, capacity appreciation, investment outlook 2025 2026",
  },
  {
    id: "invest-fund",
    lens: "space investment funds, managed fleets, collective investment performance",
  },

  // 26-30: News & editorial
  {
    id: "news-press",
    lens: "space press coverage, industry news, trade publications, breaking news",
  },
  {
    id: "news-blog",
    lens: "space blogs, independent analyses, operator opinions, expert columns",
  },
  {
    id: "news-podcast",
    lens: "space podcast transcripts, audio content, expert interviews",
  },
  {
    id: "news-social",
    lens: "space community discussion, social media sentiment, trending topics",
  },
  {
    id: "news-regulation",
    lens: "ITU filings, FCC rules, EU policy, spectrum coordination agreements",
  },

  // 31-35: Operator expertise
  {
    id: "operator-spacex",
    lens: "SpaceX specific: Starlink, Falcon 9, Dragon, constellation phases",
  },
  {
    id: "operator-oneweb",
    lens: "OneWeb / Eutelsat specific: Gen1 fleet, gateway network, polar shells",
  },
  {
    id: "operator-planet",
    lens: "Planet Labs specific: Dove SuperDove, SkySat, Pelican, imaging cadence",
  },
  {
    id: "operator-intelsat",
    lens: "Intelsat / SES specific: GEO fleet, HTS, prestige orbital slots, EOL",
  },
  {
    id: "operator-chinese",
    lens: "Chinese operators: Guowang, Qianfan, Yaogan, Beidou, experimental sats",
  },

  // 36-40: Geo scouts
  {
    id: "geo-leo",
    lens: "LEO regime, sun-sync cru shells, mega-constellations, debris flux",
  },
  {
    id: "geo-meo",
    lens: "MEO regime, navigation shells, Galileo GPS, GLONASS, regime diversity",
  },
  {
    id: "geo-heo",
    lens: "HEO / Molniya orbits, Tundra, early warning, oxidative environment trend",
  },
  {
    id: "geo-geo",
    lens: "GEO belt, graveyard orbits, emerging slots, collocation clusters",
  },
  {
    id: "geo-cislunar",
    lens: "cislunar investment assets: NRHO, Lagrange points, TLI, EML1, DRO",
  },

  // 41-45: Trend detection
  {
    id: "trend-emerging",
    lens: "emerging operator countries, new ITU filings, rising stars, discovery",
  },
  {
    id: "trend-rideshare",
    lens: "rideshare movement, low-cost access, smallsat aggregation, Transporter missions",
  },
  {
    id: "trend-climate",
    lens: "space-weather impact on orbits, adaptation strategies, new shells",
  },
  {
    id: "trend-consumer",
    lens: "end-user behavior shifts, demographics, millennials Gen Z direct-to-device",
  },
  {
    id: "trend-tech",
    lens: "space tech, AI on-orbit, blockchain provenance, digital twin tools",
  },

  // 46-50: Data mining
  {
    id: "data-academic",
    lens: "academic orbit research, astrodynamics papers, space surveillance studies, AIAA",
  },
  {
    id: "data-statistics",
    lens: "satellite population statistics, UCS data, launch numbers, active counts",
  },
  {
    id: "data-fraud",
    lens: "satellite spoofing detection, authentication, counterfeit signals, provenance",
  },
  {
    id: "data-storage",
    lens: "on-orbit storage, station-keeping budgets, optimal disposal, EOL tracking",
  },
  {
    id: "data-pairing",
    lens: "payload host-platform pairing research, rideshare compatibility, integrator insights",
  },
] as const;

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
 * each query with relevant researcher lenses.
 */
function decompose(scoutQueries: ExplorationQuery[]): MicroQuery[] {
  const micros: MicroQuery[] = [];

  // Sort by priority, take top 6
  const top = scoutQueries.sort((a, b) => b.priority - a.priority).slice(0, 6);

  // For each scout query, pick the most relevant lenses
  for (const sq of top) {
    const lenses = pickLenses(sq);
    for (const lens of lenses) {
      if (micros.length >= MAX_MICRO_QUERIES) break;
      micros.push({
        query: `${sq.query} — focus: ${lens.lens.split(",")[0]}`,
        researcherId: lens.id,
        lens: lens.lens,
        sourceScoutQuery: sq.query,
      });
    }
  }

  // Fill remaining slots with diverse lenses not yet used
  const usedIds = new Set(micros.map((m) => m.researcherId));
  const unused = RESEARCHER_LENSES.filter((l) => !usedIds.has(l.id));

  // Spread remaining across top queries evenly
  let qi = 0;
  for (const lens of unused) {
    if (micros.length >= MAX_MICRO_QUERIES) break;
    const sq = top[qi % top.length];
    micros.push({
      query: `${sq.query} — focus: ${lens.lens.split(",")[0]}`,
      researcherId: lens.id,
      lens: lens.lens,
      sourceScoutQuery: sq.query,
    });
    qi++;
  }

  return micros.slice(0, MAX_MICRO_QUERIES);
}

/**
 * Pick 4-8 lenses most relevant to a scout query based on type + keywords.
 */
function pickLenses(
  sq: ExplorationQuery,
): (typeof RESEARCHER_LENSES)[number][] {
  const q = sq.query.toLowerCase();
  const picked: (typeof RESEARCHER_LENSES)[number][] = [];

  // Type-based priority
  if (sq.type === "market") {
    picked.push(
      ...RESEARCHER_LENSES.filter(
        (l) =>
          l.id.startsWith("cost-") ||
          l.id.startsWith("market-") ||
          l.id.startsWith("invest-"),
      ).slice(0, 6),
    );
  } else if (sq.type === "academic") {
    picked.push(
      ...RESEARCHER_LENSES.filter(
        (l) =>
          l.id.startsWith("data-") ||
          l.id.startsWith("regime-") ||
          l.id.startsWith("trend-"),
      ).slice(0, 6),
    );
  }

  // Keyword-based enrichment
  const keywordMap: Record<string, string[]> = {
    spacex: ["operator-spacex", "cost-futures", "advisory-18scs"],
    starlink: ["operator-spacex", "cost-launch", "advisory-leolabs"],
    oneweb: ["operator-oneweb", "cost-launch", "advisory-leolabs"],
    intelsat: ["operator-intelsat", "cost-index", "trend-consumer"],
    ses: ["operator-intelsat", "advisory-18scs", "regime-space-weather"],
    rideshare: ["cost-launch", "trend-rideshare", "advisory-consensus"],
    auction: ["cost-launch", "market-brycetech", "invest-roi"],
    brycetech: ["market-brycetech", "market-volumes", "cost-index"],
    investissement: ["invest-roi", "invest-undervalued", "invest-forecast"],
    investment: ["invest-roi", "invest-undervalued", "invest-forecast"],
    "space weather": ["regime-space-weather", "trend-climate", "regime-yield"],
    swpc: ["regime-space-weather", "trend-climate", "regime-yield"],
    sustainable: ["regime-sustainable", "trend-rideshare", "trend-consumer"],
    iadc: ["regime-sustainable", "trend-rideshare", "trend-consumer"],
    heo: ["geo-heo", "trend-rideshare", "trend-emerging"],
    meo: ["geo-meo", "regime-structure", "trend-emerging"],
    leo: ["geo-leo", "trend-rideshare", "trend-emerging"],
    china: ["operator-chinese", "geo-cislunar", "cost-launch"],
    chine: ["operator-chinese", "geo-cislunar", "cost-launch"],
  };

  const usedIds = new Set<string>(picked.map((l) => l.id));
  for (const [kw, lensIds] of Object.entries(keywordMap)) {
    if (q.includes(kw)) {
      for (const id of lensIds) {
        if (!usedIds.has(id)) {
          const lens = RESEARCHER_LENSES.find((l) => l.id === id);
          if (lens) {
            picked.push(lens);
            usedIds.add(id);
          }
        }
      }
    }
  }

  // Always include at least 1 news + 1 trend
  for (const prefix of ["news-", "trend-"]) {
    if (!picked.some((l) => l.id.startsWith(prefix))) {
      const fallback = RESEARCHER_LENSES.find(
        (l) => l.id.startsWith(prefix) && !usedIds.has(l.id),
      );
      if (fallback) picked.push(fallback);
    }
  }

  return picked.slice(0, 8);
}

// ─── Nano caller ─────────────────────────────────────────────────────

async function callNano(micro: MicroQuery): Promise<NanoResult> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return {
      researcherId: micro.researcherId,
      ok: false,
      latencyMs: 0,
      urls: [],
      text: "",
      sourceQuery: micro.sourceScoutQuery,
      error: "OPENAI_API_KEY missing",
    };
  }

  const start = Date.now();

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: NANO_MODEL,
        instructions: `You are a specialized space-situational-awareness research nano-agent.
Your expertise: ${micro.lens}
Search the web and return structured findings.
IMPORTANT: Always mention specific payload types (optical imager, SAR, multispectral, hyperspectral, Ka-band transponder, Ku-band, L-band nav, etc.), orbital regimes (LEO sun-sync, MEO, GEO, HEO Molniya, cislunar, etc.), operator countries, launch vehicles, and space-weather data when relevant. Use their full names, never abbreviate.
Be concise but data-rich. Global space market focus.`,
        input: `Search: ${micro.query}

For each source found, return:
- URL
- Title
- 120-word summary that MUST include:
  * Specific payload types mentioned (e.g. optical imager, SAR, Ka-band transponder)
  * Specific orbit regimes (e.g. LEO 550 km SSO, GEO 75°E, MEO Galileo shell, cislunar NRHO)
  * Operator countries (e.g. USA, France, China, Japan)
  * Any numbers: prices in USD, Pc values, inclination in °, altitude in km, mass in kg
  * Regime / space-weather details if available (Kp index, debris flux, solar F10.7)
Return at least 2 sources.`,
        reasoning: { effort: "low" },
        tools: [{ type: "web_search_preview" }],
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        researcherId: micro.researcherId,
        ok: false,
        latencyMs,
        urls: [],
        text: "",
        sourceQuery: micro.sourceScoutQuery,
        error: `HTTP ${res.status}: ${errBody.slice(0, 100)}`,
      };
    }

    const data = (await res.json()) as Record<string, unknown>;
    const text = extractResponseText(data);
    const urls = extractUrls(text);

    return {
      researcherId: micro.researcherId,
      ok: true,
      latencyMs,
      urls,
      text,
      sourceQuery: micro.sourceScoutQuery,
    };
  } catch (err: unknown) {
    return {
      researcherId: micro.researcherId,
      ok: false,
      latencyMs: Date.now() - start,
      urls: [],
      text: "",
      sourceQuery: micro.sourceScoutQuery,
      error: err instanceof Error ? err.message.slice(0, 80) : "Unknown error",
    };
  }
}

function extractResponseText(data: Record<string, unknown>): string {
  const output = data.output as Array<Record<string, unknown>> | undefined;
  if (!output) return "";
  return output
    .filter((o) => o.type === "message")
    .flatMap((o) => (o.content as Array<Record<string, unknown>>) ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => (c.text as string) ?? "")
    .join("\n");
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)"'\]>]+/g) ?? [];
  return [
    ...new Set(
      matches
        // Strip trailing backticks, markdown, punctuation
        .map((u) => u.replace(/[`*_~]+$/g, "").replace(/[.,;:!?)]+$/g, ""))
        // Strip utm params
        .map((u) => u.replace(/[?&]utm_source=[^&]+/g, ""))
        // Normalize trailing slash
        .map((u) => u.replace(/\/+$/, "")),
    ),
  ].filter(
    (u) =>
      u.length > 15 &&
      !u.includes("google.com/search") &&
      !u.includes("utm_source=openai"),
  );
}

/**
 * Strip markdown formatting so entity extraction works on clean prose.
 * Removes: **bold**, `backticks`, [links](url), #headers, bullet prefixes, code blocks
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "") // code blocks
    .replace(/`([^`]+)`/g, "$1") // inline backticks
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) → text
    .replace(/^#{1,6}\s+/gm, "") // # headers
    .replace(/^[-*+]\s+/gm, "") // bullet prefixes
    .replace(/^\d+[.)]\s+/gm, "") // numbered lists
    .replace(/\|/g, " ") // table pipes
    .replace(/---+/g, "") // horizontal rules
    .replace(/\s{2,}/g, " "); // collapse whitespace
}

/**
 * Normalize URL for dedup: strip utm params, trailing slash, lowercase hostname.
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    // Remove tracking params
    for (const p of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "ref",
    ]) {
      u.searchParams.delete(p);
    }
    // Strip trailing slash from pathname
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

// ─── Wave executor ───────────────────────────────────────────────────

async function executeWaves(micros: MicroQuery[]): Promise<NanoResult[]> {
  const allResults: NanoResult[] = [];
  const totalWaves = Math.ceil(micros.length / WAVE_SIZE);

  for (let w = 0; w < micros.length; w += WAVE_SIZE) {
    const wave = micros.slice(w, w + WAVE_SIZE);
    const waveNum = Math.floor(w / WAVE_SIZE) + 1;

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

    // Rate limit delay between waves (skip after last)
    if (w + WAVE_SIZE < micros.length) {
      await new Promise((r) => setTimeout(r, WAVE_DELAY_MS));
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
    // Clean the full response text once (strip markdown for better entity extraction)
    const cleanText = stripMarkdown(r.text);

    // Create one article per unique URL found
    for (const url of r.urls) {
      // Normalize for dedup: lowercase hostname, strip trailing slash
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

      // Build body: domain-relevant lines + full text for max context
      const lines = cleanText
        .split("\n")
        .filter((l: string) => l.trim().length > 10);
      const domainKey = domain.split(".")[0];
      const relevantLines = lines.filter((l: string) =>
        l.toLowerCase().includes(domainKey),
      );
      const domainContext = relevantLines.join(" ");
      const body =
        domainContext.length > 100
          ? (domainContext + "\n" + cleanText).slice(0, 3000)
          : cleanText.slice(0, 3000);

      // Extract entities from FULL nano response (payloads, operator countries, orbit regime)
      const entities = extractSatelliteEntities(cleanText);
      const dpRe = new RegExp(DATA_POINT_RE.source, DATA_POINT_RE.flags);
      const dataPoints: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = dpRe.exec(cleanText)) !== null) dataPoints.push(m[0]);

      // Try to extract a real title from context (first mention of domain)
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

    // Synthetic article for nano responses without URLs (analysis-only)
    if (cleanText.length > 200 && r.urls.length === 0) {
      const entities = extractSatelliteEntities(cleanText);
      const dpRe = new RegExp(DATA_POINT_RE.source, DATA_POINT_RE.flags);
      const dataPoints: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = dpRe.exec(cleanText)) !== null) dataPoints.push(m[0]);

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
  // Estimate: ~1.5K input tokens + ~0.8K output tokens per call
  // nano pricing: $0.20/1M in, $1.25/1M out (estimated)
  const estimatedCost =
    (results.length * 1500 * 0.2 + results.length * 800 * 1.25) / 1_000_000;

  const stats: SwarmStats = {
    totalCalls: results.length,
    successCalls: successful.length,
    failedCalls: results.length - successful.length,
    wallTimeMs: 0, // set by caller
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
   * Takes scout queries, decomposes into 50 micro-queries,
   * runs them in waves, merges and deduplicates results.
   */
  async crawl(scoutQueries: ExplorationQuery[]): Promise<{
    articles: CrawledArticle[];
    urlsCrawled: number;
    stats: SwarmStats;
  }> {
    const globalStart = Date.now();

    // 1. Decompose scout queries into micro-queries
    const micros = decompose(scoutQueries);
    logger.info(
      {
        scoutQueries: scoutQueries.length,
        microQueries: micros.length,
        researchers: [...new Set(micros.map((m) => m.researcherId))].length,
      },
      "Nano swarm decomposed queries",
    );

    // 2. Execute in waves
    const results = await executeWaves(micros);

    // 3. Merge & dedup
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

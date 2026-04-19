import {
  createLlmTransport,
  type ExplorationQuery,
} from "@interview/thalamus";
import { extractJsonArray } from "@interview/shared/utils";
import { createLogger } from "@interview/shared/observability";
import type { Database } from "@interview/db-schema";
import { sql } from "drizzle-orm";

const logger = createLogger("explorer-scout");

export type { ExplorationQuery };

interface ScoutInput {
  recentFindings: Array<{ title: string; summary: string; cortex: string }>;
  recentRssTrends: Array<{ title: string; sourceName: string }>;
  previousExplorations: Array<{
    query: string;
    itemsInjected: number;
    qualityScore: number | null;
  }>;
  trackedDomains: string[];
}

const SCOUT_PROMPT = `You are the curiosity engine of a Space Situational Awareness (SSA) research brain called Thalamus.

Given recent research findings, RSS trends, and past exploration results, generate 5-8 exploration queries that would EXPAND our knowledge surface — new satellite operators, orbital regimes, conjunction and maneuver data, launch manifests, radar/telemetry sources, and scientific insights we don't yet track.

Focus on:
- Entities mentioned in findings but poorly sourced (< 3 mentions)
- Orbital traffic trends accelerating faster than our source coverage
- Academic research that could inform orbit determination, debris modeling, or regime characterization
- Operational intelligence gaps (operators, launch providers, ground stations, SSA data custodians)

Avoid:
- Domains we already track (provided in context)
- Queries similar to past explorations with 0 items injected
- Generic queries like "space news" — be SPECIFIC

Respond with ONLY a JSON array: [{ "query": "...", "type": "web|academic|market", "signal": "what triggered this", "priority": 1-10, "maxDepth": 1-2 }]`;

export class ExplorerScout {
  async generateQueries(input: ScoutInput): Promise<ExplorationQuery[]> {
    const context = this.buildContext(input);

    const transport = createLlmTransport(SCOUT_PROMPT);

    try {
      const response = await transport.call(context);
      const queries = this.parseQueries(response.content);

      logger.info(
        { queryCount: queries.length, types: queries.map((q) => q.type) },
        "Scout generated exploration queries",
      );

      if (queries.length === 0) {
        logger.warn("LLM returned 0 parseable queries, using fallback");
        return this.fallbackQueries(input);
      }

      return queries;
    } catch (err) {
      logger.error({ err }, "Scout query generation failed");
      return this.fallbackQueries(input);
    }
  }

  static async gatherSignals(db: Database): Promise<ScoutInput> {
    const findingsResult = await db.execute(sql`
      SELECT title, summary, cortex
      FROM research_finding
      WHERE created_at > now() - interval '7 days'
        AND status = 'active'
      ORDER BY confidence DESC
      LIMIT 20
    `);

    const rssResult = await db.execute(sql`
      SELECT si.title, s.name as "sourceName"
      FROM source_item si
      JOIN source s ON s.id = si.source_id
      WHERE s.kind = 'rss'
        AND si.fetched_at > now() - interval '7 days'
      ORDER BY si.score DESC NULLS LAST
      LIMIT 15
    `);

    const explorationResult = await db.execute(sql`
      SELECT query, items_injected as "itemsInjected", quality_score as "qualityScore"
      FROM exploration_log
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const domainsResult = await db.execute(sql`
      SELECT DISTINCT regexp_replace(url, '^https?://([^/]+).*', '\\1') as domain
      FROM source
      WHERE is_enabled = true AND kind = 'rss'
    `);

    return {
      recentFindings: findingsResult.rows as ScoutInput["recentFindings"],
      recentRssTrends: rssResult.rows as ScoutInput["recentRssTrends"],
      previousExplorations:
        explorationResult.rows as ScoutInput["previousExplorations"],
      trackedDomains: (domainsResult.rows as Array<{ domain: string }>).map(
        (r) => r.domain,
      ),
    };
  }

  private buildContext(input: ScoutInput): string {
    const sections: string[] = [];

    if (input.recentFindings.length > 0) {
      sections.push(
        "## Recent Research Findings\n" +
          input.recentFindings
            .map(
              (f) => `- [${f.cortex}] ${f.title}: ${f.summary.slice(0, 100)}`,
            )
            .join("\n"),
      );
    }

    if (input.recentRssTrends.length > 0) {
      sections.push(
        "## Trending RSS Items\n" +
          input.recentRssTrends
            .map((t) => `- [${t.sourceName}] ${t.title}`)
            .join("\n"),
      );
    }

    if (input.previousExplorations.length > 0) {
      const good = input.previousExplorations.filter(
        (e) => e.itemsInjected > 0,
      );
      const bad = input.previousExplorations.filter(
        (e) => e.itemsInjected === 0,
      );

      if (good.length > 0) {
        sections.push(
          "## Past Successful Explorations (generate similar)\n" +
            good
              .map((e) => `- "${e.query}" -> ${e.itemsInjected} items`)
              .join("\n"),
        );
      }
      if (bad.length > 0) {
        sections.push(
          "## Past Failed Explorations (avoid similar)\n" +
            bad.map((e) => `- "${e.query}" -> 0 results`).join("\n"),
        );
      }
    }

    if (input.trackedDomains.length > 0) {
      sections.push(
        "## Already Tracked Domains (skip)\n" + input.trackedDomains.join(", "),
      );
    }

    return sections.join("\n\n");
  }

  private parseQueries(content: string): ExplorationQuery[] {
    const items = extractJsonArray(content);
    return this.validateQueries(items);
  }

  private validateQueries(raw: unknown[]): ExplorationQuery[] {
    return raw
      .filter(
        (q: any) =>
          q &&
          typeof q.query === "string" &&
          q.query.length > 5 &&
          q.query.length < 200,
      )
      .map((q: any) => ({
        query: q.query,
        type: ["web", "academic", "market"].includes(q.type) ? q.type : "web",
        signal: String(q.signal ?? "curiosity").slice(0, 200),
        priority: Math.max(1, Math.min(10, Number(q.priority) || 5)),
        maxDepth: Math.max(1, Math.min(2, Number(q.maxDepth) || 1)),
      }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 8);
  }

  private fallbackQueries(input: ScoutInput): ExplorationQuery[] {
    // Build targeted queries from findings — short, specific, searchable
    const queries: ExplorationQuery[] = [];

    // Extract actionable entities from findings
    const seen = new Set<string>();
    for (const f of input.recentFindings.slice(0, 10)) {
      // Extract operators, satellite names, regimes from titles
      const words = f.title
        .replace(/[«»"':,—–\-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const key = words.slice(0, 3).join(" ").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      if (queries.length >= 6) break;

      // Build specific search queries by cortex type
      if (
        f.cortex === "replacement_cost_analyst" ||
        f.cortex === "deal_scanner"
      ) {
        queries.push({
          query: `${words.slice(0, 4).join(" ")} satellite replacement cost launch contract 2025`,
          type: "market",
          signal: `replacement cost finding: ${f.title.slice(0, 60)}`,
          priority: 7,
          maxDepth: 1,
        });
      } else if (
        f.cortex === "traffic_spotter" ||
        f.cortex === "advisory_radar"
      ) {
        queries.push({
          query: `${words.slice(0, 4).join(" ")} conjunction advisory close approach analysis`,
          type: "web",
          signal: `traffic finding: ${f.title.slice(0, 60)}`,
          priority: 6,
          maxDepth: 1,
        });
      } else {
        queries.push({
          query: `${words.slice(0, 4).join(" ")} satellite orbit analysis 2025`,
          type: "web",
          signal: `finding: ${f.title.slice(0, 60)}`,
          priority: 5,
          maxDepth: 1,
        });
      }
    }

    // Always add evergreen discovery queries
    const evergreen: ExplorationQuery[] = [
      {
        query: "site:celestrak.org TLE catalog update 2025",
        type: "market",
        signal: "evergreen: CelesTrak catalog data",
        priority: 8,
        maxDepth: 1,
      },
      {
        query: "site:space-track.org conjunction data message 2024 2025",
        type: "web",
        signal: "evergreen: Space-Track CDM advisories",
        priority: 7,
        maxDepth: 1,
      },
      {
        query: "launch manifest SpaceX Arianespace ULA 2025 operator payload",
        type: "market",
        signal: "evergreen: launch manifest data",
        priority: 7,
        maxDepth: 1,
      },
      {
        query: "orbital debris modeling LEO GEO regime research 2025",
        type: "academic",
        signal: "evergreen: debris academic research",
        priority: 5,
        maxDepth: 1,
      },
    ];

    // Add evergreen queries not already covered
    for (const eq of evergreen) {
      if (queries.length >= 8) break;
      queries.push(eq);
    }

    return queries;
  }
}

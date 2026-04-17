/**
 * Standard execution strategy — the default cortex pipeline:
 *   1. Run the skill's SQL helper (via injected data provider)
 *   2. Fetch external structured sources
 *   3. Optional web-search enrichment (via WebSearchPort)
 *   4. Pre-summarize + sanitize payload
 *   5. Call LLM with skill body + sanitized payload + previous findings
 *
 * Handles every cortex that doesn't match a more specific strategy.
 */

import { createLogger } from "@interview/shared/observability";
import {
  ResearchFindingType,
  ResearchUrgency,
} from "@interview/shared/enum";
import type { CortexSkill } from "../registry";
import type {
  CortexFinding,
  CortexInput,
  CortexOutput,
  CortexDataProvider,
  DomainConfig,
} from "../types";
import { analyzeCortexData } from "../cortex-llm";
import { sanitizeDataPayload, sanitizeText } from "../guardrails";
import { fetchSourcesForCortex } from "../sources";
import type { WebSearchPort } from "../../ports/web-search.port";
import { emptyOutput, normalizeFinding } from "./helpers";
import type { CortexExecutionStrategy } from "./types";

const logger = createLogger("cortex-standard");

export class StandardStrategy implements CortexExecutionStrategy {
  constructor(
    private readonly dataProvider: CortexDataProvider,
    private readonly domainConfig: DomainConfig,
    private readonly webSearch: WebSearchPort,
  ) {}

  /** Fallback strategy — accepts every cortex. Register last. */
  canHandle(_cortexName: string): boolean {
    return true;
  }

  async execute(skill: CortexSkill, input: CortexInput): Promise<CortexOutput> {
    const start = Date.now();
    const cortexName = skill.header.name;

    // User-scoped cortices require userId.
    if (this.domainConfig.userScopedCortices.has(cortexName)) {
      const userId = input.params.userId;
      if (!userId) {
        logger.warn(
          { cortex: cortexName },
          "Missing userId for user-scoped cortex",
        );
        return emptyOutput();
      }
    }

    // 1. Run SQL helper to fetch data.
    const sqlData = await this.runSqlHelper(skill, input.params);

    // 1b. Fetch external structured sources for this cortex.
    let sourceData: Record<string, unknown>[] = [];
    try {
      const sources = await fetchSourcesForCortex(cortexName, input.params);
      sourceData = sources.map((s) => ({
        type: s.type,
        _source: s.source,
        _sourceUrl: s.url,
        ...(typeof s.data === "object" && s.data !== null
          ? (s.data as Record<string, unknown>)
          : { value: s.data }),
      }));
      if (sources.length > 0) {
        logger.info(
          {
            cortex: cortexName,
            sources: sources.length,
            types: sources.map((s) => s.type),
          },
          "External sources enriched data",
        );
      }
    } catch (err) {
      logger.debug(
        { cortex: cortexName, err },
        "External source fetch failed (non-blocking)",
      );
    }

    // 2. Enrich with web for cortices that benefit, or when SQL is empty.
    let webData: unknown[] = [];
    if (
      this.domainConfig.webEnrichedCortices.has(cortexName) ||
      sqlData.length === 0
    ) {
      logger.info(
        { cortex: cortexName, sqlRows: sqlData.length },
        sqlData.length === 0
          ? "SQL helper returned no data, trying web search fallback"
          : "Enriching SQL data with web search",
      );

      webData = await this.webSearchFallback(input.query, cortexName);
    }

    const authoritativeData = [...sqlData, ...sourceData];

    if (authoritativeData.length === 0 && webData.length === 0) {
      logger.info({ cortex: cortexName }, "No data from SQL or web search");
      return emptyOutput();
    }

    // 3. Map-Reduce: SQL did the math, now pre-summarize for LLM narration.
    //    SQL+structured-sources and web-search are kept in separate tiers so
    //    the LLM can treat one as authoritative (scoped by query params, e.g.
    //    horizonDays) and the other as advisory context (unfiltered,
    //    potentially out-of-scope). Blending them caused the LLM to cite
    //    web-only launches as if they were inside the requested window.
    const authoritative = this.domainConfig.preSummarize(
      authoritativeData as Record<string, unknown>[],
      cortexName,
    );
    const webContext =
      webData.length > 0
        ? this.domainConfig.preSummarize(
            webData as Record<string, unknown>[],
            cortexName,
          )
        : [];

    // 4. Sanitize each tier separately — strip prompt injections, filter off-topic.
    const { sanitized: authoritativePayload, stats } = sanitizeDataPayload(
      authoritative,
      {
        maxItems: 30,
        requireDomainRelevance:
          this.domainConfig.relevanceFilteredCortices.has(cortexName),
        keywords: this.domainConfig.keywords,
      },
    );
    const webPayload =
      webContext.length > 0
        ? sanitizeDataPayload(webContext, {
            maxItems: 10,
            requireDomainRelevance:
              this.domainConfig.relevanceFilteredCortices.has(cortexName),
            keywords: this.domainConfig.keywords,
          }).sanitized
        : "";

    const dataPayload = webPayload
      ? `## AUTHORITATIVE DATA (from internal SQL + structured sources — scoped by query params)\n${authoritativePayload}\n\n## WEB CONTEXT (unfiltered web-search snippets — advisory only, may include out-of-scope items)\n${webPayload}\n\nIMPORTANT: Ground every finding in AUTHORITATIVE DATA. Use WEB CONTEXT only to cross-reference or flag uncertainty — never cite a specific launch/event/number that appears ONLY in WEB CONTEXT as if it were in scope.`
      : authoritativePayload;

    if (stats.injections > 0) {
      logger.warn(
        {
          cortex: cortexName,
          injections: stats.injections,
          filtered: stats.filtered,
        },
        "Guardrails: prompt injection patterns stripped from data",
      );
    }

    // 5. Build context from previous findings (also sanitized).
    let contextBlock = "";
    if (input.context?.previousFindings?.length) {
      const cleanFindings = input.context.previousFindings.map((f) => ({
        title: sanitizeText(f.title).clean,
        summary: sanitizeText(f.summary).clean,
        confidence: f.confidence,
      }));
      contextBlock = `\n\nPREVIOUS FINDINGS FROM UPSTREAM CORTICES:\n${JSON.stringify(cleanFindings, null, 2)}`;
    }

    // 6. Call LLM with skill body as system prompt.
    //
    // maxFindings sizing: a hardcoded cap of 5 silently broke skills whose
    // contract is "one finding per DATA row" (e.g. launch_scout emits one
    // per upcoming launch). We now allow up to one finding per
    // authoritative row, floored at 5 and capped at 30 to keep cost bounded
    // and match the sanitize `maxItems`. Skills that want fewer findings
    // still self-regulate via their own prompt body.
    const maxFindings = Math.min(30, Math.max(5, authoritativeData.length));
    const result = await analyzeCortexData({
      cortexName,
      systemPrompt: skill.body,
      dataPayload: dataPayload + contextBlock,
      maxFindings,
      enableWebSearch: this.domainConfig.webEnrichedCortices.has(cortexName),
      lang: input.lang,
      mode: input.mode,
      sourcingRules: this.domainConfig.sourcingRules,
      entityTypes: this.domainConfig.entityTypes,
    });

    // 7. Validate and normalize findings.
    const findings = result.findings.map((f) =>
      normalizeFinding(f, cortexName),
    );

    // 7b. Data-gap telemetry: LLM received data but produced nothing.
    // Likely a schema mismatch between the skill's "Inputs from DATA" and the
    // SQL helper's actual shape. Emit one meta-finding so downstream cortices
    // (strategist, reflexion) see the gap instead of silent zero.
    const allRawItems = [...authoritativeData, ...webData];
    if (findings.length === 0 && allRawItems.length > 0) {
      findings.push(
        buildDataGapFinding(cortexName, {
          sqlRows: sqlData.length,
          sourceRows: sourceData.length,
          webRows: webData.length,
          sampleKeys: allRawItems[0]
            ? Object.keys(allRawItems[0] as Record<string, unknown>)
            : [],
        }),
      );
      logger.warn(
        { cortex: cortexName, rawItems: allRawItems.length },
        "Cortex produced 0 findings despite non-empty data — emitting data-gap meta-finding",
      );
    }

    const duration = Date.now() - start;
    logger.info(
      { cortex: cortexName, findings: findings.length, duration },
      "Cortex execution complete",
    );

    return {
      findings,
      metadata: {
        tokensUsed: result.tokensEstimate,
        duration,
        model: result.model,
      },
    };
  }

  private async runSqlHelper(
    skill: CortexSkill,
    params: Record<string, unknown>,
  ): Promise<unknown[]> {
    const helperName = skill.header.sqlHelper;
    const helperFn = this.dataProvider[helperName];

    if (!helperFn) {
      logger.debug(
        { cortex: skill.header.name, sqlHelper: helperName },
        "No data provider mapped, cortex will use raw params as data",
      );
      return [];
    }

    try {
      logger.debug(
        {
          cortex: skill.header.name,
          sqlHelper: helperName,
          params,
        },
        "Calling data provider",
      );
      const result = await helperFn(params);
      if (Array.isArray(result)) return result;
      return result == null ? [] : [result as unknown];
    } catch (err) {
      logger.error(
        { cortex: skill.header.name, sqlHelper: helperName, err },
        "Data provider call failed",
      );
      return [];
    }
  }

  /**
   * Web search fallback — delegates to the injected WebSearchPort.
   * Returns generic data items for the LLM to analyse.
   */
  private async webSearchFallback(
    query: string,
    cortexName: string,
  ): Promise<unknown[]> {
    const { searchQuery, instruction } = this.domainConfig.webSearchPrompt(
      query,
      cortexName,
    );

    const text = await this.webSearch.search(instruction, searchQuery);
    if (!text) return [];

    logger.info(
      { cortex: cortexName, chars: text.length },
      "Web search fallback produced data",
    );

    return [
      {
        type: "web_search",
        source: "openai",
        query: searchQuery,
        content: text.slice(0, 3000),
      },
    ];
  }
}

/**
 * Build a synthetic "data gap" finding — emitted when a cortex received data
 * but produced no findings (usually schema mismatch with the skill's declared
 * inputs). Makes the silence visible to the strategist and to `/api/stats`.
 */
function buildDataGapFinding(
  cortexName: string,
  stats: {
    sqlRows: number;
    sourceRows: number;
    webRows: number;
    sampleKeys: string[];
  },
): CortexFinding {
  const total = stats.sqlRows + stats.sourceRows + stats.webRows;
  return {
    title: `Cortex ${cortexName}: 0 findings from ${total} data items — possible schema mismatch`,
    summary:
      `The LLM received ${total} items (${stats.sqlRows} SQL, ${stats.sourceRows} structured sources, ${stats.webRows} web) ` +
      `but emitted no findings. Likely the skill's declared "Inputs from DATA" contract isn't met by the SQL helper output. ` +
      `Sample keys present: ${stats.sampleKeys.slice(0, 10).join(", ") || "—"}.`,
    findingType: ResearchFindingType.Anomaly,
    urgency: ResearchUrgency.Low,
    evidence: [
      {
        source: "cortex_audit",
        data: stats,
        weight: 1.0,
      },
    ],
    // Confidence intentionally above the 0.7 cycle-loop gate so the gap is
    // visible in persisted findings instead of being silently filtered.
    confidence: 0.7,
    impactScore: 3,
    sourceCortex: cortexName,
    edges: [],
  };
}

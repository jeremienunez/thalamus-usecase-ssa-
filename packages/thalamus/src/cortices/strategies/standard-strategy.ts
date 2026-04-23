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
import type { CortexSkill } from "../registry";
import type {
  CortexInput,
  CortexOutput,
  CortexDataProvider,
  DomainConfig,
} from "../types";
import { analyzeCortexData } from "../cortex-llm";
import type { WebSearchPort } from "../../ports/web-search.port";
import type { SourceFetcherPort } from "../../ports/source-fetcher.port";
import { NoopSourceFetcher } from "../../entities/noop-source-fetcher";
import { emptyOutput, normalizeFinding } from "./helpers";
import { buildNoFindingMetaFinding } from "./meta-findings";
import { fetchStructuredSources, runCortexSqlHelper } from "./standard-inputs";
import { buildStandardDataPayload } from "./standard-payload";
import type { CortexExecutionStrategy } from "./types";

const logger = createLogger("cortex-standard");

export class StandardStrategy implements CortexExecutionStrategy {
  constructor(
    private readonly dataProvider: CortexDataProvider,
    private readonly domainConfig: DomainConfig,
    private readonly webSearch: WebSearchPort,
    private readonly sourceFetcher: SourceFetcherPort = new NoopSourceFetcher(),
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

    const sqlData = await runCortexSqlHelper({
      skill,
      params: input.params,
      dataProvider: this.dataProvider,
      logger,
    });
    const sourceData = await fetchStructuredSources({
      sourceFetcher: this.sourceFetcher,
      cortexName,
      params: input.params,
      logger,
    });

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

    const payload = buildStandardDataPayload({
      domainConfig: this.domainConfig,
      cortexName,
      authoritativeData,
      webData,
      previousFindings: input.context?.previousFindings,
    });

    if (payload.injections > 0) {
      logger.warn(
        {
          cortex: cortexName,
          injections: payload.injections,
          filtered: payload.filtered,
        },
        "Guardrails: prompt injection patterns stripped from data",
      );
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
      dataPayload: payload.dataPayload,
      maxFindings,
      enableWebSearch: this.domainConfig.webEnrichedCortices.has(cortexName),
      lang: input.lang,
      mode: input.mode,
      sourcingRules: this.domainConfig.sourcingRules,
      entityTypes: this.domainConfig.entityTypes,
      modeInstructions: this.domainConfig.modeInstructions,
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
        buildNoFindingMetaFinding(
          cortexName,
          {
            sqlRows: sqlData.length,
            sourceRows: sourceData.length,
            webRows: webData.length,
            sampleKeys: allRawItems[0]
              ? Object.keys(allRawItems[0] as Record<string, unknown>)
              : [],
          },
          result.diagnostic,
        ),
      );
      logger.warn(
        {
          cortex: cortexName,
          rawItems: allRawItems.length,
          diagnostic: result.diagnostic,
        },
        result.diagnostic
          ? "Cortex LLM output was rejected despite non-empty data — emitting output-quality meta-finding"
          : "Cortex produced 0 findings despite non-empty data — emitting data-gap meta-finding",
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

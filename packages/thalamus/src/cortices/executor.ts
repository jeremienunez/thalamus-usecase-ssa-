/**
 * Cortex Executor — Generic execution engine for all Thalamus cortices
 *
 * Instead of N hardcoded classes, ONE executor that:
 * 1. Reads the full skill .md body (system prompt for LLM)
 * 2. Runs the referenced SQL helper to fetch data
 * 3. Feeds data + skill body -> Kimi K2 -> structured findings
 *
 * Adding a new cortex = dropping a new .md file in skills/
 */

import { createLogger } from "@interview/shared/observability";
import type { CortexRegistry, CortexSkill } from "./registry";
import type {
  CortexInput,
  CortexOutput,
  CortexFinding,
  CortexDataProvider,
  DomainConfig,
} from "./types";
import { analyzeCortexData } from "./cortex-llm";
import { createLlmTransportWithMode } from "../transports/factory";
import { sanitizeDataPayload, sanitizeText } from "./guardrails";
import { fetchSourcesForCortex } from "./sources";
import {
  ResearchCortex,
  ResearchFindingType,
  ResearchUrgency,
  ResearchEntityType,
  ResearchRelation,
} from "@interview/shared/enum";

const logger = createLogger("cortex-executor");

// Data provider map is injected by the app composition root.
// No SQL_HELPER_MAP, no import from "./queries", no Database import.

// Cortex classifications (userScoped / webEnriched) come from DomainConfig.
// Web-search prompt templates come from DomainConfig.

export class CortexExecutor {
  constructor(
    private registry: CortexRegistry,
    private dataProvider: CortexDataProvider,
    private domainConfig: DomainConfig,
  ) {}

  /**
   * Execute a single cortex by name.
   * Reads skill file -> runs SQL -> calls LLM -> returns structured findings.
   */
  async execute(cortexName: string, input: CortexInput): Promise<CortexOutput> {
    const start = Date.now();
    const skill = this.registry.get(cortexName);

    if (!skill) {
      logger.error({ cortexName }, "Cortex skill not found");
      return emptyOutput(cortexName);
    }

    logger.info(
      { cortex: cortexName, query: input.query },
      "Cortex execution started",
    );

    // Strategist meta-cortex: reads findings, not SQL.
    if (cortexName === ResearchCortex.Strategist) {
      const prevFindings = input.context?.previousFindings ?? [];
      if (prevFindings.length === 0) {
        logger.info(
          { cortex: cortexName },
          "No previous findings for strategist",
        );
        return emptyOutput(cortexName);
      }

      const dataPayload = JSON.stringify(
        prevFindings.map((f) => ({
          title: sanitizeText(f.title).clean,
          summary: sanitizeText(f.summary).clean,
          confidence: f.confidence,
        })),
      );

      const result = await analyzeCortexData({
        cortexName,
        systemPrompt: skill.body,
        dataPayload,
        maxFindings: 4,
        enableWebSearch: false,
        lang: input.lang,
        mode: input.mode,
      });

      const findings = result.findings.map((f) =>
        normalizeFinding(f, cortexName),
      );

      const duration = Date.now() - start;
      logger.info(
        {
          cortex: cortexName,
          findings: findings.length,
          duration,
          sourceFindings: prevFindings.length,
        },
        "Strategist synthesis complete",
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

    // User-scoped cortices require userId.
    if (this.domainConfig.userScopedCortices.has(cortexName)) {
      const userId = input.params.userId;
      if (!userId) {
        logger.warn(
          { cortex: cortexName },
          "Missing userId for user-scoped cortex",
        );
        return emptyOutput(cortexName);
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

    const rawData = [...sqlData, ...sourceData, ...webData];

    if (rawData.length === 0) {
      logger.info({ cortex: cortexName }, "No data from SQL or web search");
      return emptyOutput(cortexName);
    }

    // 3. Map-Reduce: SQL did the math, now pre-summarize for LLM narration.
    //    Send aggregated insights, not raw rows — fewer tokens, faster, cheaper.
    //    Domain provides the strategy (per-cortex grouping rules).
    const data = this.domainConfig.preSummarize(
      rawData as Record<string, unknown>[],
      cortexName,
    );

    // 4. Sanitize — strip prompt injections, filter off-topic content.
    const { sanitized: dataPayload, stats } = sanitizeDataPayload(data, {
      maxItems: 30,
      requireDomainRelevance:
        this.domainConfig.relevanceFilteredCortices.has(cortexName),
      keywords: this.domainConfig.keywords,
    });

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

    // 6. Call LLM with skill body as system prompt. Enable Kimi built-in web
    //    search for cortices that need external data.
    const result = await analyzeCortexData({
      cortexName,
      systemPrompt: skill.body,
      dataPayload: dataPayload + contextBlock,
      maxFindings: 5,
      enableWebSearch: this.domainConfig.webEnrichedCortices.has(cortexName),
      lang: input.lang,
      mode: input.mode,
    });

    // 7. Validate and normalize findings.
    const findings = result.findings.map((f) =>
      normalizeFinding(f, cortexName),
    );

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
   * Freeform skill invocation — bypasses SQL helpers, web enrichment, and
   * structured finding parsing. Loads the skill body as system prompt and
   * calls the LLM with the given user prompt verbatim.
   *
   * Used by the editorial copilot (audit + chat) where the skill already
   * knows how to respond and we do NOT want CortexFinding[] output.
   */
  async runSkillFreeform(
    cortexName: string,
    userPrompt: string,
    opts?: { enableWebSearch?: boolean; maxRetries?: number },
  ): Promise<{ content: string; provider: string }> {
    const skill = this.registry.get(cortexName);
    if (!skill) {
      logger.error({ cortexName }, "Cortex skill not found for freeform call");
      return { content: "", provider: "none" };
    }

    // Mode-aware: honours THALAMUS_MODE=fixtures|record|cloud so sim runs
    // (which call this for every turn) are replayable offline.
    const transport = createLlmTransportWithMode(skill.body, {
      enableWebSearch: opts?.enableWebSearch ?? false,
      maxRetries: opts?.maxRetries,
    });

    const response = await transport.call(userPrompt);
    return { content: response.content, provider: response.provider };
  }

  private async runSqlHelper(
    skill: CortexSkill,
    params: Record<string, unknown>,
  ): Promise<unknown[]> {
    const helperName = skill.header.sqlHelper;
    const helperFn = this.dataProvider[helperName];

    if (!helperFn) {
      // No data provider mapped — cortex uses only LLM (e.g., strategy cortices).
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
   * Web search fallback — when SQL returns no data, search the web for
   * relevant SSA information using OpenAI web search. Returns results as
   * generic data items for the LLM to analyse.
   */
  private async webSearchFallback(
    query: string,
    cortexName: string,
  ): Promise<unknown[]> {
    try {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) return [];

      // Web-search prompt templates come from DomainConfig (app-owned).
      const { searchQuery, instruction } = this.domainConfig.webSearchPrompt(
        query,
        cortexName,
      );

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5.4-mini",
          tools: [{ type: "web_search_preview" }],
          input: instruction,
        }),
      });

      if (!response.ok) {
        logger.debug(
          { cortex: cortexName, status: response.status },
          "Web search failed",
        );
        return [];
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await response.json()) as Record<string, any>;
      const text =
        data.output
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.filter((o: any) => o.type === "message")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((o: any) => o.content?.map((c: any) => c.text).join(""))
          .join("\n") ?? "";

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
    } catch (err) {
      logger.debug({ cortex: cortexName, err }, "Web search fallback failed");
      return [];
    }
  }
}

// preSummarize moved to the domain pack — injected via DomainConfig.preSummarize.

// ============================================================================
// Helpers
// ============================================================================

function emptyOutput(_cortexName: string): CortexOutput {
  return {
    findings: [],
    metadata: { tokensUsed: 0, duration: 0, model: "none" },
  };
}

function safeNumber(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Ensure finding has valid enum values and required fields.
 * LLM might return slightly off values — normalise them.
 */
export function normalizeFinding(
  raw: Partial<CortexFinding>,
  _cortexName: string,
): CortexFinding {
  if (!raw) raw = {};
  return {
    title: raw.title ?? "Untitled finding",
    summary: raw.summary ?? "",
    findingType: validateEnum(
      raw.findingType,
      ResearchFindingType,
      ResearchFindingType.Insight,
    ),
    urgency: validateEnum(raw.urgency, ResearchUrgency, ResearchUrgency.Medium),
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    confidence: clamp(safeNumber(raw.confidence, 0.5), 0, 1),
    impactScore: clamp(safeNumber(raw.impactScore, 5), 0, 10),
    busContext: raw.busContext ?? undefined,
    dedupKey: raw.dedupKey ?? undefined,
    edges: Array.isArray(raw.edges)
      ? raw.edges.map((e) => ({
          entityType: validateEnum(
            e.entityType,
            ResearchEntityType,
            ResearchEntityType.Satellite,
          ),
          entityId: Number(e.entityId) || 0,
          relation: validateEnum(
            e.relation,
            ResearchRelation,
            ResearchRelation.About,
          ),
          context: e.context,
        }))
      : [],
  };
}

function validateEnum<T extends Record<string, string>>(
  value: unknown,
  enumObj: T,
  fallback: T[keyof T],
): T[keyof T] {
  const valid = new Set(Object.values(enumObj));
  return valid.has(value as string) ? (value as T[keyof T]) : fallback;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

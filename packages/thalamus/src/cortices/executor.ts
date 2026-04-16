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
import type { Database } from "@interview/db-schema";
import type { CortexRegistry, CortexSkill } from "./registry";
import type { CortexInput, CortexOutput, CortexFinding } from "./types";
import { analyzeCortexData } from "./cortex-llm";
import { createLlmTransport } from "../transports/llm-chat";
import { createLlmTransportWithMode } from "../transports/factory";
import * as sqlHelpers from "./queries";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlHelperFn = (db: Database, ...args: any[]) => Promise<unknown[]>;

/**
 * Map of sqlHelper names (referenced in skill frontmatter) -> functions from
 * sql-helpers.ts. Names follow the SSA vocabulary (satellite / payload /
 * orbit regime / conjunction / maneuver).
 *
 * We cast through `unknown` because helpers may return rows OR a single
 * shaped object. The executor treats results as an array of unknowns.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const helpers = sqlHelpers as unknown as Record<string, any>;

const SQL_HELPER_MAP: Record<string, SqlHelperFn> = Object.fromEntries(
  Object.entries(helpers)
    .filter(([, v]) => typeof v === "function")
    .map(([k, v]) => [k, v as SqlHelperFn]),
);

/**
 * Cortex names that require a userId in params (fleet-scoped work).
 * Matches the SSA cortex vocabulary.
 */
const USER_SCOPED_CORTICES = new Set<string>([
  ResearchCortex.FleetAnalyst,
  ResearchCortex.AdvisoryRadar,
]);

/**
 * Cortex names that benefit from (or require) external web enrichment on top
 * of the local SQL payload.
 */
const WEB_ENRICHED_CORTICES = new Set<string>([
  ResearchCortex.LaunchScout,
  ResearchCortex.DebrisForecaster,
  ResearchCortex.RegimeProfiler,
  ResearchCortex.AdvisoryRadar,
  ResearchCortex.ApogeeTracker,
  ResearchCortex.PayloadProfiler,
  ResearchCortex.BriefingProducer,
]);

export class CortexExecutor {
  constructor(
    private registry: CortexRegistry,
    private db: Database,
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
    if (USER_SCOPED_CORTICES.has(cortexName)) {
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
    if (WEB_ENRICHED_CORTICES.has(cortexName) || sqlData.length === 0) {
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
    const data = preSummarize(rawData as Record<string, unknown>[], cortexName);

    // 4. Sanitize — strip prompt injections, filter off-topic content.
    const { sanitized: dataPayload, stats } = sanitizeDataPayload(data, {
      maxItems: 30,
      requireDomainRelevance:
        cortexName === ResearchCortex.AdvisoryRadar ||
        cortexName === ResearchCortex.DebrisForecaster,
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
      enableWebSearch: WEB_ENRICHED_CORTICES.has(cortexName),
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
    const helperFn = SQL_HELPER_MAP[helperName];

    if (!helperFn) {
      // No SQL helper — cortex uses only LLM (e.g., trend cortices with RSS).
      logger.debug(
        { cortex: skill.header.name, sqlHelper: helperName },
        "No SQL helper mapped, cortex will use raw params as data",
      );
      return [];
    }

    try {
      // Drop orbitRegime if not in the known set — lets the helper scan all
      // regimes rather than returning nothing for a typo.
      const KNOWN_ORBIT_REGIMES = new Set([
        "LEO",
        "MEO",
        "GEO",
        "HEO",
        "SSO",
        "GTO",
        "Lunar",
        "Cislunar",
        "Heliocentric",
      ]);
      const cleanParams = { ...params };
      if (
        cleanParams.orbitRegime &&
        !KNOWN_ORBIT_REGIMES.has(cleanParams.orbitRegime as string)
      ) {
        logger.debug(
          {
            cortex: skill.header.name,
            invalidOrbitRegime: cleanParams.orbitRegime,
          },
          "Removing invalid orbitRegime param — will scan all regimes",
        );
        delete cleanParams.orbitRegime;
      }

      logger.debug(
        {
          cortex: skill.header.name,
          sqlHelper: helperName,
          params: cleanParams,
        },
        "Running SQL helper",
      );
      const result = await helperFn(this.db, cleanParams);
      if (Array.isArray(result)) return result;
      return result == null ? [] : [result as unknown];
    } catch (err) {
      logger.error(
        { cortex: skill.header.name, sqlHelper: helperName, err },
        "SQL helper execution failed",
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

      // Cortex-specific search prompts for targeted results.
      const CORTEX_SEARCH_PROMPTS: Record<
        string,
        (q: string) => { searchQuery: string; instruction: string }
      > = {
        [ResearchCortex.PayloadProfiler]: (q) => ({
          searchQuery: `payload instrument spectrometer radar bus ${q}`.slice(
            0,
            200,
          ),
          instruction: `Search for technical data about the payload / instrument referenced in: ${q}. Look for manufacturer specs, instrument class (radar, EO, comms, SIGINT), mission heritage and bus integration. Cite sources.`,
        }),
        [ResearchCortex.RegimeProfiler]: (q) => ({
          searchQuery: `orbit regime altitude inclination LEO MEO GEO ${q}`.slice(
            0,
            200,
          ),
          instruction: `Search for orbit-regime context relevant to: ${q}. Focus on altitude bands, inclination, station-keeping duty cycle, congestion and debris profile. Cite sources.`,
        }),
        [ResearchCortex.LaunchScout]: (q) => ({
          searchQuery: `launch manifest rideshare fairing slot pricing ${q}`.slice(
            0,
            200,
          ),
          instruction: `Search for upcoming launches, manifests, rideshare availability and slot economics relevant to: ${q}. Include LSP, vehicle, trajectory, and price per kg where available.`,
        }),
      };

      const cortexPrompt = CORTEX_SEARCH_PROMPTS[cortexName];
      const { searchQuery, instruction } = cortexPrompt
        ? cortexPrompt(query)
        : {
            searchQuery: `space situational awareness ${cortexName.replace(/_/g, " ")} ${query}`.slice(
              0,
              200,
            ),
            instruction: `Search for authoritative SSA / space-traffic data relevant to: ${cortexName.replace(/_/g, " ")} ${query}. Prioritise CelesTrak, Space-Track, ESA, NASA CNEOS, operator advisories and peer-reviewed sources. Return key facts, numbers, epochs and provenance.`,
          };

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

// ============================================================================
// Pre-Summarize: SQL did the math, LLM narrates the verdict (Karpathy pattern)
// ============================================================================

/**
 * Transform raw SQL rows into pre-computed insights.
 * Instead of sending 200 rows to the LLM, send aggregate stats and a handful
 * of exemplars. The LLM's job becomes: write the finding, not do the analysis.
 */
export function preSummarize(
  rows: Record<string, unknown>[],
  cortexName: string,
): Record<string, unknown>[] {
  if (rows.length === 0) return [];

  // Apogee Tracker: group by mission-health signal.
  if (cortexName === ResearchCortex.ApogeeTracker) {
    const signals = new Map<string, Record<string, unknown>[]>();

    for (const row of rows) {
      const phase = String(row.currentPhase ?? "unknown");
      const yearsToEol = Number(row.yearsToEol) || 0;

      let signal = "HOLD";
      if (phase === "nominal" && yearsToEol > 5) signal = "HEALTHY";
      else if (phase === "nominal" && yearsToEol > 0 && yearsToEol <= 2)
        signal = "PLAN_REPLACEMENT";
      else if (phase === "extended") signal = "RETIRE_OR_DEORBIT";
      else if (phase === "degraded") signal = "URGENT_REPLACE";

      if (!signals.has(signal)) signals.set(signal, []);
      signals.get(signal)!.push(row);
    }

    const insights: Record<string, unknown>[] = [];
    for (const [signal, satellites] of signals) {
      if (signal === "HOLD" || signal === "HEALTHY") continue;
      insights.push({
        type: "mission_health_signal",
        signal,
        count: satellites.length,
        topSatellites: satellites.slice(0, 3).map((s) => ({
          name: String(s.name).slice(0, 60),
          operator: s.operatorName,
          orbitRegime: s.orbitRegimeName,
          currentPhase: s.currentPhase,
          yearsToEol: s.yearsToEol,
          id: s.id,
        })),
      });
    }

    return insights;
  }

  // Fleet Analyst: already pre-aggregated by SQL, pass through.
  if (cortexName === ResearchCortex.FleetAnalyst) {
    return rows;
  }

  // Advisory Radar: already aggregated in SQL, pass through.
  if (cortexName === ResearchCortex.AdvisoryRadar) {
    return rows;
  }

  // Classification Auditor: group by severity.
  if (cortexName === ResearchCortex.ClassificationAuditor) {
    const bySeverity = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const sev = String(row.severity ?? "medium");
      if (!bySeverity.has(sev)) bySeverity.set(sev, []);
      bySeverity.get(sev)!.push(row);
    }
    const insights: Record<string, unknown>[] = [];
    for (const [severity, items] of bySeverity) {
      const totalAffected = items.reduce(
        (s, i) => s + (Number(i.count) || 0),
        0,
      );
      insights.push({
        type: "audit_group",
        severity,
        issueTypes: items.length,
        totalAffectedEntities: totalAffected,
        items: items.slice(0, 5),
      });
    }
    return insights;
  }

  // Payload Profiler: group heterogeneous data by category.
  if (cortexName === ResearchCortex.PayloadProfiler) {
    const byType = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const type = String(row.type ?? "unknown");
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(row);
    }

    const insights: Record<string, unknown>[] = [];

    const identity = byType.get("identity")?.[0];
    if (identity) insights.push(identity);

    const satelliteDist = byType.get("satellite_distribution") ?? [];
    if (satelliteDist.length > 0) {
      insights.push({
        type: "satellite_distribution_summary",
        operatorCount: satelliteDist.length,
        distribution: satelliteDist.slice(0, 10),
      });
    }

    const payloadMatches = byType.get("payload_mission") ?? [];
    if (payloadMatches.length > 0) {
      insights.push({
        type: "mission_summary",
        matchCount: payloadMatches.length,
        matches: payloadMatches.slice(0, 10),
      });
    }

    const batchTargets = byType.get("batch_target") ?? [];
    if (batchTargets.length > 0) insights.push(...batchTargets);

    const findings = byType.get("prior_finding") ?? [];
    if (findings.length > 0) {
      insights.push({
        type: "prior_findings_summary",
        count: findings.length,
        findings: findings.slice(0, 5),
      });
    }

    return insights;
  }

  // Default: take top 10 rows as-is.
  return rows.slice(0, 10);
}

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


import { createLogger } from "@interview/shared/observability";
import {
  type ConfigProvider,
  type NanoSweepConfig,
  DEFAULT_NANO_SWEEP_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import type { NanoCaller, NanoRequest } from "./nano-caller.port";
import type {
  AuditCycleContext,
  AuditCandidate,
  DomainAuditProvider,
} from "@interview/sweep";
import type { SuggestionFeedbackRow, SweepRepository } from "@interview/sweep";
import type { SweepFeedbackEntry } from "../../../types/sweep.types";
import {
  buildSsaAuditInstructions,
  SSA_BRIEFING_INSTRUCTIONS,
} from "../../../prompts";
import { parseSsaFindingPayload } from "./finding-schema.ssa";
import { ssaResolutionPayloadSchema } from "./resolution-schema.ssa";
import {
  type CitationResolver,
  createDefaultCitationResolver,
} from "./citation-resolver.ssa";

// ─── Ports (ISP) ──────────────────────────────────────────────────
// The provider depends on narrow structural ports, not on concrete
// repository classes. `container.ts` wires real repositories that
// satisfy these shapes; tests pass lightweight fakes.

export interface NullScanRow {
  operatorCountryId: bigint | null;
  operatorCountryName: string;
  totalSatellites: number;
  column: string;
  nullCount: number;
  nullFraction: number;
}

export interface OperatorCountrySweepStatsRow {
  operatorCountryId: bigint;
  operatorCountryName: string;
  orbitRegimeName: string;
  satelliteCount: number;
  missingPayloads: number;
  missingOrbitRegime: number;
  missingLaunchYear: number;
  missingMass: number;
  hasDoctrine: boolean;
  avgMass: number | null;
  topPayloads: string[];
  sampleSatellites: Array<{
    name: string;
    massKg: number;
    launchYear: number | null;
  }>;
}

export interface AuditSatellitePort {
  nullScanByColumn(opts?: {
    maxOperatorCountries?: number;
    minNullFraction?: number;
    minTotal?: number;
    columns?: string[];
  }): Promise<NullScanRow[]>;
  findSatelliteIdsWithNullColumn(opts: {
    operatorCountryId: bigint | null;
    column: string;
    limit?: number;
  }): Promise<bigint[]>;
  getOperatorCountrySweepStats(): Promise<OperatorCountrySweepStatsRow[]>;
}

export interface AuditFeedbackPort {
  push(entry: SweepFeedbackEntry): Promise<void>;
}

const logger = createLogger("ssa-audit-provider");

interface OperatorCountryBatch {
  operatorCountries: Array<{
    id: bigint;
    name: string;
    orbitRegime: string;
    satelliteCount: number;
    topPayloads: string[];
    sampleSatellites: Array<{
      name: string;
      massKg: number;
      launchYear: number | null;
    }>;
    missing: {
      payloads: number;
      orbitRegime: number;
      launchYear: number;
      mass: number;
    };
    hasDoctrine: boolean;
    avgMass: number | null;
  }>;
}

interface PastFeedback {
  category: string;
  wasAccepted: boolean;
  reviewerNote: string | null;
  operatorCountryName: string;
}

const CATEGORIES = new Set([
  "mass_anomaly",
  "missing_data",
  "doctrine_mismatch",
  "relationship_error",
  "enrichment",
  "briefing_angle",
]);
function validCategory(c: string): string {
  return CATEGORIES.has(c) ? c : "enrichment";
}
function validSeverity(s: string): string {
  return s === "critical" || s === "warning" || s === "info" ? s : "info";
}

export interface SsaAuditDeps {
  satelliteRepo: AuditSatellitePort;
  /** Used only for loadPastFeedback; writes go via insertGeneric on the engine side. */
  sweepRepo: Pick<SweepRepository, "loadPastFeedback">;
  /** Feedback recording (recordFeedback port method). */
  feedbackRepo?: AuditFeedbackPort;
  /** Optional — runtime-tunable batch size + null-scan caps. Defaults when unset. */
  config?: ConfigProvider<NanoSweepConfig>;
  /** Optional — override for testing or for extending with new source strategies. */
  citationResolver?: CitationResolver;
  /** Required — LLM transport port. Container injects the default thalamus adapter. */
  nanoCaller: NanoCaller;
}

export class SsaAuditProvider implements DomainAuditProvider {
  private readonly config: ConfigProvider<NanoSweepConfig>;
  private readonly citationResolver: CitationResolver;

  constructor(private readonly deps: SsaAuditDeps) {
    this.config =
      deps.config ?? new StaticConfigProvider(DEFAULT_NANO_SWEEP_CONFIG);
    this.citationResolver =
      deps.citationResolver ?? createDefaultCitationResolver();
  }

  async runAudit(ctx: AuditCycleContext): Promise<AuditCandidate[]> {
    const cfg = await this.config.get();
    const targetOperatorCountryIds = parseTargetOperatorCountryIds(ctx);

    if (ctx.mode === "nullScan") {
      return this.nullScan(
        ctx.limit,
        cfg.nullScanMaxIdsPerSuggestion,
        targetOperatorCountryIds,
        ctx.target?.columnHints,
      );
    }

    const operatorCountries = await this.gatherOperatorCountryData(
      ctx.limit,
      targetOperatorCountryIds,
    );
    logger.info(
      { cycleId: ctx.cycleId, count: operatorCountries.length, mode: ctx.mode },
      "ssa audit: operator-countries gathered",
    );

    const feedback = (await this.deps.sweepRepo.loadPastFeedback()).map(
      toPastFeedback,
    );

    const batches: OperatorCountryBatch[] = [];
    for (let i = 0; i < operatorCountries.length; i += cfg.batchSize) {
      batches.push({
        operatorCountries: operatorCountries.slice(i, i + cfg.batchSize),
      });
    }

    const results = await this.deps.nanoCaller.callWaves(batches, (batch) =>
      ctx.mode === "briefing"
        ? this.buildBriefingRequest(batch)
        : this.buildNanoRequest(batch, feedback),
    );

    const candidates: AuditCandidate[] = [];
    for (const r of results) {
      if (!r.ok) continue;
      const batch = batches[r.index]!;
      const parsed = this.parseSuggestions(r.text, batch);
      if (ctx.mode === "briefing") {
        for (const s of parsed) {
          (s.domainFields as Record<string, unknown>).category = "briefing_angle";
          (s.domainFields as Record<string, unknown>).severity = "info";
          (s.domainFields as Record<string, unknown>).affectedSatellites = 0;
        }
      }
      candidates.push(...parsed);
    }
    return candidates;
  }

  async recordFeedback(input: {
    suggestionId: string;
    accepted: boolean;
    reviewerNote: string | null;
    domainFields: Record<string, unknown>;
  }): Promise<void> {
    if (!this.deps.feedbackRepo) return;
    await this.deps.feedbackRepo.push({
      category: String(input.domainFields.category ?? ""),
      wasAccepted: input.accepted,
      reviewerNote: input.reviewerNote ?? "",
      operatorCountryName: String(input.domainFields.operatorCountryName ?? ""),
    });
  }

  // ─── Null-scan ────────────────────────────────────────────────────

  private async nullScan(
    maxOperatorCountries: number | undefined,
    maxIdsPerSuggestion: number,
    targetOperatorCountryIds?: bigint[],
    columnHints?: string[],
  ): Promise<AuditCandidate[]> {
    const rows = (await this.deps.satelliteRepo.nullScanByColumn({
      maxOperatorCountries:
        targetOperatorCountryIds && targetOperatorCountryIds.length > 0
          ? 500
          : maxOperatorCountries,
      columns:
        columnHints && columnHints.length > 0 ? columnHints : undefined,
    })).filter((row) =>
      targetOperatorCountryIds && targetOperatorCountryIds.length > 0
        ? row.operatorCountryId !== null &&
          targetOperatorCountryIds.some((id) => id === row.operatorCountryId)
        : true,
    );
    const out: AuditCandidate[] = [];
    for (const r of rows) {
      const satelliteIds = await this.deps.satelliteRepo
        .findSatelliteIdsWithNullColumn({
          column: r.column,
          operatorCountryId: r.operatorCountryId,
          limit: maxIdsPerSuggestion,
        })
        .catch((): bigint[] => []);

      const pct = Math.round(r.nullFraction * 100);
      const severity: "critical" | "warning" | "info" =
        r.nullFraction >= 0.5
          ? "critical"
          : r.nullFraction >= 0.25
            ? "warning"
            : "info";

      out.push({
        domainFields: {
          operatorCountryId: r.operatorCountryId,
          operatorCountryName: r.operatorCountryName,
          category: "missing_data",
          severity,
          title: `${r.operatorCountryName}: ${pct}% of ${r.totalSatellites} satellites missing ${r.column}`,
          description:
            `${r.nullCount}/${r.totalSatellites} rows have a null value on ` +
            `"${r.column}" for operator country "${r.operatorCountryName}". ` +
            `Detected by deterministic null-scan (no LLM, information_schema introspection).`,
          affectedSatellites: r.nullCount,
          suggestedAction: this.citationResolver.resolve(r.column),
          webEvidence: null,
        },
        resolutionPayload: JSON.stringify({
          actions: [
            {
              kind: "update_field",
              field: r.column,
              value: null,
              satelliteIds: satelliteIds.map((id: bigint) => id.toString()),
            },
          ],
        }),
      });
    }
    return out;
  }

  // ─── Data gathering ───────────────────────────────────────────────

  private async gatherOperatorCountryData(
    maxOperatorCountries?: number,
    targetOperatorCountryIds?: bigint[],
  ): Promise<OperatorCountryBatch["operatorCountries"]> {
    const allStats =
      await this.deps.satelliteRepo.getOperatorCountrySweepStats();
    const filtered =
      targetOperatorCountryIds && targetOperatorCountryIds.length > 0
        ? allStats.filter((row) =>
            targetOperatorCountryIds.some((id) => id === row.operatorCountryId),
          )
        : allStats;
    const limited = maxOperatorCountries
      ? filtered.slice(0, maxOperatorCountries)
      : filtered;
    return limited.map((a) => ({
      id: a.operatorCountryId,
      name: a.operatorCountryName,
      orbitRegime: a.orbitRegimeName,
      satelliteCount: a.satelliteCount,
      topPayloads: a.topPayloads,
      sampleSatellites: a.sampleSatellites,
      missing: {
        payloads: a.missingPayloads,
        orbitRegime: a.missingOrbitRegime,
        launchYear: a.missingLaunchYear,
        mass: a.missingMass,
      },
      hasDoctrine: a.hasDoctrine,
      avgMass: a.avgMass,
    }));
  }

  // ─── Prompt building ──────────────────────────────────────────────

  private buildNanoRequest(
    batch: OperatorCountryBatch,
    feedback: PastFeedback[],
  ): NanoRequest {
    const feedbackLines = feedback
      .filter((f) =>
        batch.operatorCountries.some(
          (a) => a.name.toLowerCase() === f.operatorCountryName?.toLowerCase(),
        ),
      )
      .slice(0, 5)
      .map(
        (f) =>
          `- ${f.operatorCountryName}: ${f.category} → ${f.wasAccepted ? "ACCEPTED" : "REJECTED"}${f.reviewerNote ? ` (${f.reviewerNote})` : ""}`,
      );

    const feedbackBlock =
      feedbackLines.length > 0
        ? `\n\nPast reviewer feedback (learn from this):\n${feedbackLines.join("\n")}`
        : "";

    return {
      instructions: buildSsaAuditInstructions(feedbackBlock),
      input: JSON.stringify(
        batch.operatorCountries.map((a) => ({
          operatorCountry: a.name,
          orbitRegime: a.orbitRegime,
          satellites: a.satelliteCount,
          topPayloads: a.topPayloads,
          missing: a.missing,
          doctrine: a.hasDoctrine,
          avgMass: a.avgMass ? Math.round(a.avgMass) : null,
          sample: a.sampleSatellites,
        })),
      ),
      enableWebSearch: true,
    };
  }

  private buildBriefingRequest(batch: OperatorCountryBatch): NanoRequest {
    return {
      instructions: SSA_BRIEFING_INSTRUCTIONS,
      input: JSON.stringify(
        batch.operatorCountries.map((a) => ({
          operatorCountry: a.name,
          orbitRegime: a.orbitRegime,
          satellites: a.satelliteCount,
          topPayloads: a.topPayloads,
          avgMass: a.avgMass ? Math.round(a.avgMass) : null,
          sample: a.sampleSatellites,
        })),
      ),
      enableWebSearch: true,
    };
  }

  // ─── Response parsing ─────────────────────────────────────────────

  private parseSuggestions(
    text: string,
    batch: OperatorCountryBatch,
  ): AuditCandidate[] {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    let items: Record<string, unknown>[];
    try {
      const parsed = JSON.parse(match[0]);
      items = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
    return items
      .filter((item) => item.operatorCountry && item.category && item.title)
      .map((item) => {
        const oc = batch.operatorCountries.find(
          (a) =>
            a.name.toLowerCase() ===
            (item.operatorCountry as string).toLowerCase(),
        );
        let resolutionPayload: string | null = null;
        if (item.resolutionPayload) {
          const parsed = ssaResolutionPayloadSchema.safeParse(
            item.resolutionPayload,
          );
          if (parsed.success) {
            resolutionPayload = JSON.stringify(parsed.data);
          }
        }
        return {
          domainFields: {
            operatorCountryId: oc?.id ?? null,
            operatorCountryName: (item.operatorCountry as string) ?? "",
            category: validCategory(item.category as string),
            severity: validSeverity(item.severity as string),
            title: (item.title as string).slice(0, 200),
            description: ((item.description as string) ?? "").slice(0, 1000),
            affectedSatellites: Number(item.affectedSatellites) || 0,
            suggestedAction: ((item.suggestedAction as string) ?? "").slice(
              0,
              500,
            ),
            webEvidence: (item.webEvidence as string) ?? null,
          },
          resolutionPayload,
        };
      });
  }
}

function parseTargetOperatorCountryIds(ctx: AuditCycleContext): bigint[] | undefined {
  if (ctx.target?.entityType !== "operator_country") return undefined;
  const ids = (ctx.target.entityIds ?? [])
    .map((id) => {
      try {
        return BigInt(id);
      } catch {
        return null;
      }
    })
    .filter((id): id is bigint => id !== null);
  return ids.length > 0 ? ids : undefined;
}

function toPastFeedback(entry: SuggestionFeedbackRow): PastFeedback {
  try {
    const parsed = parseSsaFindingPayload(entry.domainFields);
    return {
      category: parsed.category,
      wasAccepted: entry.wasAccepted,
      reviewerNote: entry.reviewerNote,
      operatorCountryName: parsed.operatorCountryName,
    };
  } catch {
    return {
      category: "",
      wasAccepted: entry.wasAccepted,
      reviewerNote: entry.reviewerNote,
      operatorCountryName: "",
    };
  }
}

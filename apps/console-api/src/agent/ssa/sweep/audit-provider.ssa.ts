
import { createLogger } from "@interview/shared/observability";
import {
  type ConfigProvider,
  type NanoSweepConfig,
  DEFAULT_NANO_SWEEP_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import {
  callNanoWaves,
  type NanoRequest,
} from "@interview/thalamus/explorer/nano-caller";
import type {
  AuditCycleContext,
  AuditCandidate,
  DomainAuditProvider,
} from "@interview/sweep";
import type { SuggestionFeedbackRow, SweepRepository } from "@interview/sweep";
import type { SatelliteRepository } from "../../../repositories/satellite.repository";
import type { SweepFeedbackRepository } from "../../../repositories/sweep-feedback.repository";
import {
  buildSsaAuditInstructions,
  SSA_BRIEFING_INSTRUCTIONS,
} from "../../../prompts";
import { parseSsaFindingPayload } from "./finding-schema.ssa";
import { ssaResolutionPayloadSchema } from "./resolution-schema.ssa";

const logger = createLogger("ssa-audit-provider");

/**
 * Per-column backfill citation — tells the reviewer WHERE the missing value
 * should come from. Column keys match the `satellite` Drizzle schema.
 */
function backfillCitationFor(column: string): string {
  const mapping: Record<string, string> = {
    mass_kg:
      "Back-fill from GCAT `DryMass`/`Mass`/`TotMass` (planet4589.org/space/gcat, CC-BY).",
    satellite_bus_id:
      "Back-fill from GCAT `Bus` field cross-referenced with `satellite_bus.name`.",
    platform_class_id:
      "Infer from CelesTrak GROUP (gps-ops → navigation, starlink → communications, weather → earth_observation, military → military, science → science).",
    launch_year: "Derive from GCAT `LDate` or CelesTrak TLE epoch.",
    operator_country_id:
      "Infer from GCAT `State` field or operator home jurisdiction.",
    operator_id: "Infer from GCAT `Owner` field or operator master list.",
  };
  if (mapping[column]) return mapping[column]!;
  const privateTelemetry = new Set([
    "power_draw",
    "thermal_margin",
    "pointing_accuracy",
    "attitude_rate",
    "payload_duty",
    "solar_array_health",
    "battery_depth_of_discharge",
    "propellant_remaining",
  ]);
  if (privateTelemetry.has(column)) {
    return (
      `Operator-private telemetry — no public source. Route to sim-fish ` +
      `multi-agent inference (SPEC-TH-040 SIM_UNCORROBORATED) and surface as ` +
      `a separate suggestion with source_class tagging.`
    );
  }
  return `Back-fill "${column}" from operator ingest or operator datasheet.`;
}

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
  satelliteRepo: SatelliteRepository;
  /** Used only for loadPastFeedback; writes go via insertGeneric on the engine side. */
  sweepRepo: Pick<SweepRepository, "loadPastFeedback">;
  /** Feedback recording (recordFeedback port method). */
  feedbackRepo?: SweepFeedbackRepository;
  /** Optional — runtime-tunable batch size + null-scan caps. Defaults when unset. */
  config?: ConfigProvider<NanoSweepConfig>;
}

export class SsaAuditProvider implements DomainAuditProvider {
  private readonly config: ConfigProvider<NanoSweepConfig>;

  constructor(private readonly deps: SsaAuditDeps) {
    this.config =
      deps.config ?? new StaticConfigProvider(DEFAULT_NANO_SWEEP_CONFIG);
  }

  async runAudit(ctx: AuditCycleContext): Promise<AuditCandidate[]> {
    const cfg = await this.config.get();

    if (ctx.mode === "nullScan") {
      return this.nullScan(ctx.limit, cfg.nullScanMaxIdsPerSuggestion);
    }

    const operatorCountries = await this.gatherOperatorCountryData(ctx.limit);
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

    const results = await callNanoWaves(batches, (batch) =>
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
  ): Promise<AuditCandidate[]> {
    const rows = await this.deps.satelliteRepo.nullScanByColumn({
      maxOperatorCountries,
    });
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
          suggestedAction: backfillCitationFor(r.column),
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
  ): Promise<OperatorCountryBatch["operatorCountries"]> {
    const allStats =
      await this.deps.satelliteRepo.getOperatorCountrySweepStats();
    const limited = maxOperatorCountries
      ? allStats.slice(0, maxOperatorCountries)
      : allStats;
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

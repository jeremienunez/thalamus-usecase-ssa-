/**
 * SsaAuditProvider — lifts packages/sweep/src/services/nano-sweep.service.ts
 * behind the DomainAuditProvider port.
 *
 * Three audit modes (the pack owns the vocabulary):
 *   - "nullScan":     deterministic null-fraction audit, no LLM.
 *   - "dataQuality":  nano waves over operator-country batches, validates
 *                      payload/regime coherence. Default.
 *   - "briefing":     nano waves that surface mission-operator angles.
 *
 * The provider returns AuditCandidate[]; the engine's façade
 * (NanoSweepService.sweep in Phase 2) persists them via
 * SweepRepository.insertGeneric.
 *
 * Plan 1 Task 4.2: satelliteRepo is now console-api's own SatelliteRepository
 * (the audit methods getOperatorCountrySweepStats + nullScanByColumn +
 * findSatelliteIdsWithNullColumn were folded in by Task 4.1). sweepRepo is
 * still the sweep-side interface — only `loadPastFeedback` is consumed, and
 * the sweep container owns it.
 */

import { createLogger } from "@interview/shared/observability";
import {
  callNanoWaves,
  type NanoRequest,
} from "@interview/thalamus/explorer/nano-caller";
import type {
  AuditCycleContext,
  AuditCandidate,
  DomainAuditProvider,
} from "@interview/sweep";
import type { SweepRepository, PastFeedback } from "@interview/sweep";
import { resolutionPayloadSchema } from "@interview/sweep";
import type { SatelliteRepository } from "../../../repositories/satellite.repository";
import type { SweepFeedbackRepository } from "../../../repositories/sweep-feedback.repository";

const logger = createLogger("ssa-audit-provider");

const BATCH_SIZE = 10; // operator-countries per nano call

/**
 * Null-scan: bound the satellite IDs bundled in each suggestion's resolution
 * payload. Reviewer can accept/reject the lot; if more rows are affected than
 * the cap, another suggestion covers the residual (auto-surfaces on next run).
 */
const NULL_SCAN_MAX_IDS_PER_SUGGESTION = 200;

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
}

export class SsaAuditProvider implements DomainAuditProvider {
  constructor(private readonly deps: SsaAuditDeps) {}

  async runAudit(ctx: AuditCycleContext): Promise<AuditCandidate[]> {
    if (ctx.mode === "nullScan") {
      return this.nullScan(ctx.limit);
    }

    const operatorCountries = await this.gatherOperatorCountryData(ctx.limit);
    logger.info(
      { cycleId: ctx.cycleId, count: operatorCountries.length, mode: ctx.mode },
      "ssa audit: operator-countries gathered",
    );

    const feedback = await this.deps.sweepRepo.loadPastFeedback();

    const batches: OperatorCountryBatch[] = [];
    for (let i = 0; i < operatorCountries.length; i += BATCH_SIZE) {
      batches.push({
        operatorCountries: operatorCountries.slice(i, i + BATCH_SIZE),
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

  private async nullScan(maxOperatorCountries?: number): Promise<AuditCandidate[]> {
    const rows = await this.deps.satelliteRepo.nullScanByColumn({
      maxOperatorCountries,
    });
    const out: AuditCandidate[] = [];
    for (const r of rows) {
      const satelliteIds = await this.deps.satelliteRepo
        .findSatelliteIdsWithNullColumn({
          column: r.column,
          operatorCountryId: r.operatorCountryId,
          limit: NULL_SCAN_MAX_IDS_PER_SUGGESTION,
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
      instructions: `You are a satellite data quality auditor for an SSA (Space Situational Awareness) catalog.
Analyze operator-country data and identify issues.

Categories: mass_anomaly, missing_data, doctrine_mismatch, relationship_error, enrichment
Severity: critical (>50% affected or mass off >5x), warning (10-50%), info (<10%)

Validate payload / operator-country coherence (NASA → EO/science/navigation, ROSCOSMOS → Cosmos/Soyuz platforms, ESA → Sentinel/Galileo, etc.)
Search the web to verify sample satellite masses and launch years against public catalogs (CelesTrak, NORAD).${feedbackBlock}

Respond ONLY with a JSON array:
[{
  "operatorCountry": "...",
  "category": "...",
  "severity": "...",
  "title": "...",
  "description": "...",
  "affectedSatellites": N,
  "suggestedAction": "human-readable description of the fix",
  "webEvidence": "optional URL",
  "resolutionPayload": {
    "type": "<category>",
    "actions": [
      { "kind": "update_field", "satelliteIds": [], "field": "mass_kg|launch_year|orbit_regime_id|operator_country_id|platform_class_id", "value": "<corrected value>" }
      OR { "kind": "link_payload", "satelliteIds": [], "payloadName": "<payload>", "role": "primary|secondary|auxiliary" }
      OR { "kind": "unlink_payload", "satelliteIds": [], "payloadName": "<payload>" }
      OR { "kind": "reassign_operator_country", "satelliteIds": [], "fromName": "<current>", "toName": "<correct>" }
      OR { "kind": "enrich", "satelliteIds": [] }
    ]
  }
}]
Return [] if no issues. satelliteIds can be empty — resolution will target all affected satellites in the operator-country.`,
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
      instructions: `You are a mission-operator briefing editor for an SSA catalog.
For each operator-country in the batch, propose ONE short-form briefing angle relevant to a fleet analyst or mission operator.
Base it on the dominant payloads, average mass, orbit regime, recent news, operational trends.

Good angles: platform-class trend (constellation build-out, debris cleanup), new payload class, launch campaign, debris risk profile, fleet age, doctrine shift, regime saturation, notable operator re-entry.

DO NOT propose: data-quality problems (missing fields, mass inconsistencies). This is NOT an audit.

Use web search to validate current events (launches, deorbits, alerts).

Respond ONLY with a JSON array:
[{
  "operatorCountry": "exact operator-country name",
  "category": "briefing_angle",
  "severity": "info",
  "title": "punchy 50-70 character briefing title",
  "description": "the briefing angle in 2 sentences — why it matters",
  "affectedSatellites": 0,
  "suggestedAction": "quick outline: intro → 2-3 sections → conclusion"
}]
Return [] if no operator-country inspires. One angle per operator-country maximum.`,
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
          const parsed = resolutionPayloadSchema.safeParse(
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

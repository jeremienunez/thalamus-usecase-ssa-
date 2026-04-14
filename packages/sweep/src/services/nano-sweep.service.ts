/**
 * Nano Sweep Service — full DB audit via nano swarm (SSA satellite catalog).
 *
 * Validates satellite data integrity by operator-country batches. Uses injected repos
 * for all SQL. Nano calls go through shared nano-caller.
 *
 * Flow: gather stats (SatelliteRepo) → batch → nano validate → store (SweepRepo)
 */

import { createLogger } from "@interview/shared/observability";
import {
  callNanoWaves,
  type NanoRequest,
} from "@interview/thalamus/explorer/nano-caller";
import type {
  SweepRepository,
  InsertSuggestion,
  PastFeedback,
} from "../repositories/sweep.repository";
import type { SatelliteRepository } from "../repositories/satellite.repository";
import type {
  SweepCategory,
  SweepMode,
  SweepSeverity,
} from "../transformers/sweep.dto";
import { resolutionPayloadSchema } from "../transformers/sweep.dto";

const logger = createLogger("nano-sweep");

const BATCH_SIZE = 10; // operator-countries per nano call

/**
 * Null-scan: bound the satellite IDs bundled in each suggestion's resolution
 * payload. Reviewer can accept/reject the lot; if more rows are affected than
 * the cap, another suggestion covers the residual (auto-surfaces on next sweep).
 */
const NULL_SCAN_MAX_IDS_PER_SUGGESTION = 200;

/**
 * Per-column backfill citation — tells the reviewer WHERE the missing value
 * should come from, not just that it's missing. Column keys match the
 * `satellite` Drizzle schema.
 */
function backfillCitationFor(column: string): string {
  const mapping: Record<string, string> = {
    mass_kg:
      "Back-fill from GCAT `DryMass`/`Mass`/`TotMass` (planet4589.org/space/gcat, CC-BY).",
    satellite_bus_id:
      "Back-fill from GCAT `Bus` field cross-referenced with `satellite_bus.name`.",
    platform_class_id:
      "Infer from CelesTrak GROUP (gps-ops → navigation, starlink → communications, weather → earth_observation, military → military, science → science).",
    launch_year:
      "Derive from GCAT `LDate` or CelesTrak TLE epoch.",
    operator_country_id:
      "Infer from GCAT `State` field or operator home jurisdiction.",
    operator_id:
      "Infer from GCAT `Owner` field or operator master list.",
  };
  if (mapping[column]) return mapping[column]!;
  // Operator-private 14D telemetry: no public source.
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

// ─── Types ───────────────────────────────────────────────────────────

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

export interface SweepResult {
  totalOperatorCountries: number;
  totalCalls: number;
  successCalls: number;
  suggestionsStored: number;
  wallTimeMs: number;
  estimatedCost: number;
}

// ─── Service ─────────────────────────────────────────────────────────

export type SweepCompleteCallback = (result: SweepResult) => Promise<void>;

export class NanoSweepService {
  private onCompleteCallbacks: SweepCompleteCallback[] = [];

  constructor(
    private satelliteRepo: SatelliteRepository,
    private sweepRepo: SweepRepository,
  ) {}

  onComplete(cb: SweepCompleteCallback): void {
    this.onCompleteCallbacks.push(cb);
  }

  async sweep(
    maxOperatorCountries?: number,
    mode: SweepMode = "dataQuality",
  ): Promise<SweepResult> {
    // Deterministic null-scan path: no LLM, no nano waves. One suggestion
    // per (operator_country × nullable scalar column) where null_fraction
    // crosses threshold. Covers every scalar column on satellite today and
    // auto-adapts when new columns land (information_schema introspection).
    if (mode === "nullScan") {
      return this.nullScanSweep({ maxOperatorCountries });
    }

    const start = Date.now();

    // 1. Gather operator-country data via existing repos
    const operatorCountries = await this.gatherOperatorCountryData(
      maxOperatorCountries,
    );
    logger.info(
      { count: operatorCountries.length, mode },
      "OperatorCountries gathered for sweep",
    );

    // 2. Load past reviewer feedback for self-improvement
    const feedback = await this.sweepRepo.loadPastFeedback();

    // 3. Build batches
    const batches: OperatorCountryBatch[] = [];
    for (let i = 0; i < operatorCountries.length; i += BATCH_SIZE) {
      batches.push({
        operatorCountries: operatorCountries.slice(i, i + BATCH_SIZE),
      });
    }

    // 4. Execute nano waves — each batch = 1 nano call
    const results = await callNanoWaves(batches, (batch) =>
      mode === "briefing"
        ? this.buildBriefingRequest(batch)
        : this.buildNanoRequest(batch, feedback),
    );

    // 5. Parse + store suggestions
    const allSuggestions: InsertSuggestion[] = [];
    let successCalls = 0;

    for (const r of results) {
      if (!r.ok) continue;
      successCalls++;

      const batch = batches[r.index];
      const parsed = this.parseSuggestions(r.text, batch);
      if (mode === "briefing") {
        for (const s of parsed) {
          s.category = "briefing_angle";
          s.severity = "info";
          s.affectedSatellites = 0;
        }
      }
      allSuggestions.push(...parsed);
    }

    const stored = await this.sweepRepo.insertMany(allSuggestions);

    const result: SweepResult = {
      totalOperatorCountries: operatorCountries.length,
      totalCalls: results.length,
      successCalls,
      suggestionsStored: stored,
      wallTimeMs: Date.now() - start,
      estimatedCost:
        (results.length * 2000 * 0.2 + results.length * 1000 * 1.25) /
        1_000_000,
    };

    logger.info(
      {
        operatorCountries: result.totalOperatorCountries,
        suggestions: result.suggestionsStored,
        cost: `$${result.estimatedCost.toFixed(3)}`,
        wallTime: `${(result.wallTimeMs / 1000).toFixed(0)}s`,
      },
      "Nano sweep complete",
    );

    // Fire completion callbacks (messaging notifications)
    for (const cb of this.onCompleteCallbacks) {
      try {
        await cb(result);
      } catch (err) {
        logger.error({ err }, "Sweep onComplete callback failed");
      }
    }

    return result;
  }

  /**
   * Null-scan mode — deterministic, LLM-free, cheap data-quality audit.
   *
   * Pipeline per (operator_country × nullable scalar column):
   *   1. `satelliteRepo.nullScanByColumn` aggregates null_fraction per column
   *      per operator country from information_schema introspection.
   *   2. Suggestions above the configured threshold get their actual
   *      satellite IDs via `findSatelliteIdsWithNullColumn` so the resolution
   *      payload can be executed against a concrete row set.
   *   3. Severity is graduated: ≥50% → critical, ≥25% → warning, else info.
   *   4. `suggestedAction` carries a column-specific backfill citation
   *      (GCAT for mass/bus/launch_year, CelesTrak GROUPs for platform_class,
   *      sim-fish for operator-private 14D telemetry). Reviewer sees where
   *      the data should come from, not just that it's missing.
   *   5. Resolution payload ships the real satelliteIds so accept =
   *      immediate update once the reviewer supplies a value.
   */
  private async nullScanSweep(opts: {
    maxOperatorCountries?: number;
  }): Promise<SweepResult> {
    const start = Date.now();
    const rows = await this.satelliteRepo.nullScanByColumn({
      maxOperatorCountries: opts.maxOperatorCountries,
    });

    const suggestions: InsertSuggestion[] = [];
    for (const r of rows) {
      // Pull a bounded sample of satellite IDs so the resolution payload
      // can actually execute when a reviewer accepts.
      const satelliteIds = await this.satelliteRepo
        .findSatelliteIdsWithNullColumn({
          column: r.column,
          operatorCountryId: r.operatorCountryId,
          limit: NULL_SCAN_MAX_IDS_PER_SUGGESTION,
        })
        .catch(() => []);

      const pct = Math.round(r.nullFraction * 100);
      const severity: "critical" | "warning" | "info" =
        r.nullFraction >= 0.5
          ? "critical"
          : r.nullFraction >= 0.25
            ? "warning"
            : "info";

      suggestions.push({
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
        resolutionPayload: JSON.stringify({
          actions: [
            {
              kind: "update_field",
              field: r.column,
              value: null, // reviewer supplies the value at accept-time
              satelliteIds: satelliteIds.map((id: bigint) => id.toString()),
            },
          ],
        }),
      });
    }

    const stored = await this.sweepRepo.insertMany(suggestions);
    const result: SweepResult = {
      totalOperatorCountries: rows.length,
      totalCalls: 0, // no LLM calls — this is the whole point of the mode
      successCalls: 0,
      suggestionsStored: stored,
      wallTimeMs: Date.now() - start,
      estimatedCost: 0,
    };
    logger.info(
      {
        rows: rows.length,
        stored,
        wallTime: `${result.wallTimeMs}ms`,
      },
      "Null-scan sweep complete",
    );
    for (const cb of this.onCompleteCallbacks) {
      try {
        await cb(result);
      } catch (err) {
        logger.error({ err }, "Sweep complete callback failed");
      }
    }
    return result;
  }

  // ─── Data gathering (delegates to repos) ───────────────────────────

  private async gatherOperatorCountryData(
    maxOperatorCountries?: number,
  ): Promise<OperatorCountryBatch["operatorCountries"]> {
    const allStats = await this.satelliteRepo.getOperatorCountrySweepStats();
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

  // ─── Prompt building ───────────────────────────────────────────────

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

  // ─── Briefing mode — same operator-country data, different ask ────
  //
  // Asks nano to surface mission-operator-facing story angles (fleet trends,
  // doctrine changes, launch campaigns, regime-level shifts). Stored with
  // category "briefing_angle" — filtered out of admin data-quality views,
  // picked up by the briefing copilot.
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

  // ─── Response parsing ──────────────────────────────────────────────

  private parseSuggestions(
    text: string,
    batch: OperatorCountryBatch,
  ): InsertSuggestion[] {
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
        // Validate resolution payload if present
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
          resolutionPayload,
        };
      });
  }
}

// ─── Validators ──────────────────────────────────────────────────────

const CATEGORIES = new Set([
  "mass_anomaly",
  "missing_data",
  "doctrine_mismatch",
  "relationship_error",
  "enrichment",
  "briefing_angle",
]);
function validCategory(c: string): SweepCategory {
  return CATEGORIES.has(c) ? (c as SweepCategory) : "enrichment";
}
function validSeverity(s: string): SweepSeverity {
  return s === "critical" || s === "warning" || s === "info" ? s : "info";
}

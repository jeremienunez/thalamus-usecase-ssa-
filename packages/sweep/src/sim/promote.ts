/**
 * Promotion helpers — KG audit + sweep_suggestion emission for swarm modal.
 *
 * Invariant: negotiation micro-actions (propose_split, accept, reject, hold,
 * lobby) produce ZERO research_finding rows. Only maneuver / launch / retire
 * are KG-promotable. Even at swarm level, we only create a research_finding
 * + edge when the modal action is promotable.
 *
 * Flow for UC3 aggregate:
 *   1. emitSuggestionFromModal() opens a research_cycle scoped to the swarm
 *   2. If modal action is KG-promotable: insert research_finding + edge
 *   3. Insert sweep_suggestion tagged with sim_swarm_id + distribution
 *   4. Attach the new finding id to sim_swarm.outcome_report_finding_id
 */

import { sql } from "drizzle-orm";
import {
  ResearchCortex,
  ResearchCycleStatus,
  ResearchCycleTrigger,
  ResearchEntityType,
  ResearchFindingType,
  ResearchRelation,
  ResearchStatus,
  ResearchUrgency,
} from "@interview/shared";
import type { Database, TurnAction } from "@interview/db-schema";
import {
  researchCycle,
  researchEdge,
  researchFinding,
  simSwarm,
} from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("sim-promote");

export function isKgPromotable(action: TurnAction): boolean {
  return action.kind === "maneuver" || action.kind === "launch" || action.kind === "retire";
}

export function isTerminal(action: TurnAction): boolean {
  return action.kind === "accept" || action.kind === "reject";
}

/**
 * Quick lookup helper — fetch a sim_turn row by id.
 * Exposed for the swarm reporter when it walks back from the modal exemplar
 * to reconstruct a proposal's prior-turn context.
 */
export async function loadSimTurn(db: Database, simTurnId: number) {
  const rows = await db.execute(sql`
    SELECT id, sim_run_id, turn_index, actor_kind, agent_id, action,
           rationale, observable_summary
    FROM sim_turn
    WHERE id = ${BigInt(simTurnId)}
    LIMIT 1
  `);
  return rows.rows[0] ?? null;
}

// -----------------------------------------------------------------------
// Swarm → KG audit trail + sweep_suggestion
// -----------------------------------------------------------------------

import type { SwarmAggregate } from "./aggregator.service";
import type { SweepRepository } from "../repositories/sweep.repository";

export interface EmitSuggestionDeps {
  db: Database;
  sweepRepo: SweepRepository;
  /** Optional embedder for the research_finding vector. */
  embed?: (text: string) => Promise<number[] | null>;
}

/**
 * Close the UC3 loop: create a research_cycle + (optionally) a
 * research_finding for KG audit, and emit a sweep_suggestion for the
 * reviewer inbox. Returns the suggestion id (or null if the swarm has
 * no usable modal — defensive, should not happen when gated correctly).
 */
export async function emitSuggestionFromModal(
  deps: EmitSuggestionDeps,
  swarmId: number,
  aggregate: SwarmAggregate,
): Promise<string | null> {
  if (!aggregate.modal) return null;
  const modalAction = aggregate.modal.exemplarAction;

  // 1. Resolve operator + satellite context from the modal's exemplar fish.
  const targetSatelliteId =
    modalAction.kind === "maneuver" || modalAction.kind === "retire"
      ? modalAction.satelliteId
      : null;

  let operatorCountryId: bigint | null = null;
  let operatorCountryName = "swarm-consensus";
  let operatorName: string | null = null;

  if (targetSatelliteId !== null) {
    const rows = await deps.db.execute(sql`
      SELECT op.name AS operator_name,
             oc.id   AS country_id,
             oc.name AS country_name
      FROM satellite s
      LEFT JOIN operator op         ON op.id = s.operator_id
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      WHERE s.id = ${BigInt(targetSatelliteId)}
      LIMIT 1
    `);
    const r = rows.rows[0] as
      | {
          operator_name: string | null;
          country_id: string | number | null;
          country_name: string | null;
        }
      | undefined;
    if (r) {
      operatorName = r.operator_name;
      if (r.country_id !== null && r.country_id !== undefined) {
        operatorCountryId = BigInt(r.country_id);
      }
      if (r.country_name) operatorCountryName = r.country_name;
    }
  }

  const title = composeTitle(swarmId, aggregate);
  const description = composeDescription(aggregate, operatorName);
  const severity = aggregate.modal.fraction >= 0.8 ? "critical" : "warning";

  // 2. Open a research_cycle for the swarm — one cycle per swarm aggregate.
  //    The cycle is marked completed immediately; its findingsCount is set
  //    after the optional finding is inserted.
  const [cycleRow] = await deps.db
    .insert(researchCycle)
    .values({
      triggerType: ResearchCycleTrigger.System,
      triggerSource: `sim_swarm:${swarmId}`,
      corticesUsed: [ResearchCortex.ConjunctionAnalysis],
      status: ResearchCycleStatus.Completed,
      findingsCount: 0,
      startedAt: new Date(),
      completedAt: new Date(),
      dagPlan: {
        kind: "sim_swarm_modal",
        swarmId,
        modal: {
          actionKind: aggregate.modal.actionKind,
          fraction: aggregate.modal.fraction,
          exemplarSimRunId: aggregate.modal.exemplarSimRunId,
        },
      },
    })
    .returning({ id: researchCycle.id });
  if (!cycleRow) throw new Error("insert research_cycle returned no row");
  const researchCycleId = cycleRow.id;

  // 3. If the modal is KG-promotable, insert a research_finding + edge.
  let findingId: bigint | null = null;
  if (isKgPromotable(modalAction)) {
    const findingText = `${title}\n\n${description}`;
    const embedding = deps.embed ? await safeEmbed(deps.embed, findingText) : null;

    const urgency =
      aggregate.modal.fraction >= 0.8
        ? ResearchUrgency.Critical
        : ResearchUrgency.High;

    const [fRow] = await deps.db
      .insert(researchFinding)
      .values({
        researchCycleId,
        cortex: ResearchCortex.ConjunctionAnalysis,
        findingType: ResearchFindingType.Strategy,
        status: ResearchStatus.Active,
        urgency,
        title,
        summary: describeAction(modalAction),
        evidence: [
          {
            source: "sim_swarm",
            swarmId,
            totalFish: aggregate.totalFish,
            succeededFish: aggregate.succeededFish,
            modal: {
              actionKind: aggregate.modal.actionKind,
              fraction: aggregate.modal.fraction,
              exemplarSimRunId: aggregate.modal.exemplarSimRunId,
            },
            clusters: aggregate.clusters.map((c) => ({
              label: c.label,
              fraction: c.fraction,
              memberFishIndexes: c.memberFishIndexes,
            })),
            weight: aggregate.modal.fraction,
          },
        ],
        reasoning: description,
        confidence: aggregate.modal.fraction,
        impactScore: aggregate.modal.fraction,
        embedding: embedding ?? null,
      })
      .returning({ id: researchFinding.id });
    if (!fRow) throw new Error("insert research_finding returned no row");
    findingId = fRow.id;

    const targetEntity = actionTarget(modalAction);
    if (targetEntity) {
      await deps.db.insert(researchEdge).values({
        findingId,
        entityType: targetEntity.entityType,
        entityId: BigInt(targetEntity.entityId),
        relation: ResearchRelation.Affects,
        weight: 1.0,
        context: {
          swarmId,
          simRunId: aggregate.modal.exemplarSimRunId,
          source: "sim_swarm_modal",
        },
      });
    }

    await deps.db
      .update(researchCycle)
      .set({ findingsCount: 1 })
      .where(sql`id = ${researchCycleId}`);

    // Attach the finding to sim_swarm for provenance.
    await deps.db
      .update(simSwarm)
      .set({ outcomeReportFindingId: findingId })
      .where(sql`id = ${BigInt(swarmId)}`);
  }

  // 4. Emit the sweep_suggestion (reviewer inbox).
  const simDistribution = JSON.stringify({
    swarmId,
    totalFish: aggregate.totalFish,
    succeededFish: aggregate.succeededFish,
    failedFish: aggregate.failedFish,
    quorumMet: aggregate.quorumMet,
    divergenceScore: Number(aggregate.divergenceScore.toFixed(4)),
    modal: {
      actionKind: aggregate.modal.actionKind,
      fraction: Number(aggregate.modal.fraction.toFixed(4)),
      exemplarSimRunId: aggregate.modal.exemplarSimRunId,
    },
    clusters: aggregate.clusters.map((c) => ({
      label: c.label,
      fraction: Number(c.fraction.toFixed(4)),
      memberFishIndexes: c.memberFishIndexes,
      exemplarSimRunId: c.exemplarSimRunId,
      exemplarAction: c.exemplarAction,
    })),
    researchCycleId: Number(researchCycleId),
    researchFindingId: findingId !== null ? Number(findingId) : null,
  });

  const resolutionPayload = JSON.stringify({
    kind: "sim_swarm_modal",
    swarmId,
    action: modalAction,
    researchFindingId: findingId !== null ? Number(findingId) : null,
  });

  const suggestionId = await deps.sweepRepo.insertOne({
    operatorCountryId,
    operatorCountryName,
    category: "relationship_error",
    severity,
    title,
    description,
    affectedSatellites: targetSatelliteId !== null ? 1 : 0,
    suggestedAction: describeAction(modalAction),
    webEvidence: null,
    resolutionPayload,
    simSwarmId: String(swarmId),
    simDistribution,
  });

  logger.info(
    {
      swarmId,
      suggestionId,
      researchCycleId: Number(researchCycleId),
      researchFindingId: findingId !== null ? Number(findingId) : null,
      modalKind: aggregate.modal.actionKind,
      modalFraction: aggregate.modal.fraction,
      targetSatelliteId,
    },
    "swarm modal emitted as sweep_suggestion + KG finding",
  );

  return suggestionId;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function actionTarget(
  action: TurnAction,
):
  | { entityType: ResearchEntityType.Satellite; entityId: number }
  | { entityType: ResearchEntityType.Operator; entityId: number }
  | null {
  switch (action.kind) {
    case "maneuver":
      return { entityType: ResearchEntityType.Satellite, entityId: action.satelliteId };
    case "retire":
      return { entityType: ResearchEntityType.Satellite, entityId: action.satelliteId };
    case "launch":
      return null;
    default:
      return null;
  }
}

function composeTitle(swarmId: number, agg: SwarmAggregate): string {
  if (!agg.modal) return `Swarm ${swarmId}: no modal`;
  const pct = Math.round(agg.modal.fraction * 100);
  return `Swarm ${swarmId} consensus (${pct}% of ${agg.succeededFish}): ${describeAction(agg.modal.exemplarAction)}`;
}

function composeDescription(agg: SwarmAggregate, operatorName: string | null): string {
  if (!agg.modal) return "Swarm produced no modal outcome.";
  const target = operatorName ? ` targeting ${operatorName}'s fleet` : "";
  const divergencePct = Math.round(agg.divergenceScore * 100);
  const clusterLines = agg.clusters
    .slice(0, 5)
    .map(
      (c) =>
        `  • ${Math.round(c.fraction * 100)}%  ${c.label}  (exemplar sim_run=${c.exemplarSimRunId})`,
    )
    .join("\n");
  return [
    `A UC3 conjunction-negotiation swarm${target} converged on "${describeAction(agg.modal.exemplarAction)}" in ${Math.round(agg.modal.fraction * 100)}% of explored futures (n=${agg.succeededFish} fish, ${agg.failedFish} failed).`,
    "",
    `Divergence: ${divergencePct}% (${agg.clusters.length} distinct outcome cluster${agg.clusters.length === 1 ? "" : "s"}).`,
    "",
    "Distribution:",
    clusterLines,
    "",
    `Recommendation is the modal action; review the distribution in simDistribution for tail risks.`,
  ].join("\n");
}

function describeAction(a: TurnAction): string {
  switch (a.kind) {
    case "maneuver":
      return `maneuver satellite #${a.satelliteId} (Δv ≈ ${a.deltaVmps.toFixed(1)} m/s)`;
    case "propose_split":
      return `propose split (own Δv=${a.ownShareDeltaV.toFixed(0)} / counterparty=${a.counterpartyShareDeltaV.toFixed(0)})`;
    case "accept":
      return "accept counterparty proposal";
    case "reject":
      return "reject counterparty proposal";
    case "launch":
      return `launch +${a.satelliteCount}${a.regimeId ? ` into regime ${a.regimeId}` : ""}`;
    case "retire":
      return `retire satellite #${a.satelliteId}`;
    case "lobby":
      return `lobby ${a.policyTopic} (${a.stance})`;
    case "hold":
      return "hold";
  }
}

async function safeEmbed(
  embed: (text: string) => Promise<number[] | null>,
  text: string,
): Promise<number[] | null> {
  try {
    return await embed(text);
  } catch (err) {
    logger.warn({ err }, "embed failed in promotion");
    return null;
  }
}

// -----------------------------------------------------------------------
// Telemetry swarm → N sweep_suggestions (one per scalar)
// -----------------------------------------------------------------------

import type { TelemetryAggregate } from "./aggregator-telemetry";
import type { TelemetryScalarKey } from "@interview/db-schema";
import { TELEMETRY_SCALAR_COLUMN } from "@interview/db-schema";

export interface EmitTelemetrySuggestionsDeps {
  db: Database;
  sweepRepo: SweepRepository;
}

/**
 * Convert a per-scalar TelemetryAggregate into N sweep_suggestions —
 * one per scalar where a consensus exists. Each suggestion carries:
 *   - resolutionPayload: { kind: "update_field", field: <snake_case>, value: median }
 *   - simDistribution: full per-scalar stats (median, σ, min, max, n, values, unit)
 *   - source_class tag (in webEvidence for visibility; promotion happens on accept)
 *
 * Only scalars where the target column is currently NULL on the satellite
 * are emitted; non-NULL columns are skipped (we don't overwrite real data).
 *
 * Returns the suggestion ids created.
 */
export async function emitTelemetrySuggestions(
  deps: EmitTelemetrySuggestionsDeps,
  aggregate: TelemetryAggregate,
): Promise<string[]> {
  if (!aggregate.quorumMet) {
    logger.info(
      { swarmId: aggregate.swarmId, satelliteId: aggregate.satelliteId },
      "telemetry emit skipped — quorum not met",
    );
    return [];
  }

  // Resolve satellite + operator context once.
  const satRows = await deps.db.execute(sql`
    SELECT s.id::text AS sat_id,
           s.name     AS sat_name,
           op.name    AS operator_name,
           oc.id::text AS country_id,
           oc.name    AS country_name
    FROM satellite s
    LEFT JOIN operator op         ON op.id = s.operator_id
    LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
    WHERE s.id = ${BigInt(aggregate.satelliteId)}
    LIMIT 1
  `);
  const sat = satRows.rows[0] as
    | {
        sat_id: string;
        sat_name: string;
        operator_name: string | null;
        country_id: string | null;
        country_name: string | null;
      }
    | undefined;
  if (!sat) {
    logger.warn(
      { satelliteId: aggregate.satelliteId },
      "telemetry emit: satellite not found",
    );
    return [];
  }

  // Which scalars are currently NULL? We only emit for those.
  const nullColumns = await findNullTelemetryColumns(deps.db, aggregate.satelliteId);

  const suggestionIds: string[] = [];
  for (const key of Object.keys(aggregate.scalars) as TelemetryScalarKey[]) {
    const stats = aggregate.scalars[key];
    if (!stats) continue;
    const column = TELEMETRY_SCALAR_COLUMN[key];
    if (!nullColumns.has(column)) {
      logger.debug(
        { satelliteId: aggregate.satelliteId, column },
        "skipping scalar — target column already populated",
      );
      continue;
    }

    const { severity, sourceClass } = scoreScalar(stats, aggregate.simConfidence);

    const simDistribution = JSON.stringify({
      swarmId: aggregate.swarmId,
      satelliteId: aggregate.satelliteId,
      scalar: key,
      column,
      stats: {
        median: round(stats.median, 6),
        mean: round(stats.mean, 6),
        sigma: round(stats.sigma, 6),
        min: round(stats.min, 6),
        max: round(stats.max, 6),
        n: stats.n,
        unit: stats.unit,
        avgFishConfidence: round(stats.avgFishConfidence, 4),
        values: stats.values.map((v) => round(v, 6)),
      },
      simConfidence: round(aggregate.simConfidence, 4),
      sourceClass,
    });

    const resolutionPayload = JSON.stringify({
      kind: "update_field",
      satelliteIds: [aggregate.satelliteId],
      field: column,
      value: round(stats.median, 6),
      provenance: {
        source: "sim_swarm_telemetry",
        swarmId: aggregate.swarmId,
        sourceClass,
      },
    });

    const title = `Infer ${key} for ${sat.sat_name} ≈ ${round(stats.median, 3)} ${stats.unit}`;
    const description = [
      `Multi-agent inference from bus datasheet prior + persona perturbations across ${stats.n} fish.`,
      ``,
      `Median: ${round(stats.median, 3)} ${stats.unit} (σ ${round(stats.sigma, 3)}, min ${round(stats.min, 3)}, max ${round(stats.max, 3)}).`,
      `Self-reported fish confidence: ${round(stats.avgFishConfidence, 2)}. Swarm confidence (SIM band): ${round(aggregate.simConfidence, 2)}.`,
      ``,
      `Source class: ${sourceClass}. This is an INFERENCE, not a measurement.`,
      `Accept → UPDATE satellite SET ${column} = ${round(stats.median, 6)} + promote to OSINT_CORROBORATED.`,
      `Reject → feedback logged, next swarm adjusts prior.`,
    ].join("\n");

    const id = await deps.sweepRepo.insertOne({
      operatorCountryId: sat.country_id !== null ? BigInt(sat.country_id) : null,
      operatorCountryName: sat.country_name ?? "(no country)",
      category: "enrichment",
      severity,
      title,
      description,
      affectedSatellites: 1,
      suggestedAction: `UPDATE satellite.${column} = ${round(stats.median, 6)} ${stats.unit}`,
      webEvidence: null,
      resolutionPayload,
      simSwarmId: String(aggregate.swarmId),
      simDistribution,
    });
    suggestionIds.push(id);

    logger.info(
      {
        swarmId: aggregate.swarmId,
        satelliteId: aggregate.satelliteId,
        scalar: key,
        column,
        median: stats.median,
        sigma: stats.sigma,
        n: stats.n,
        simConfidence: aggregate.simConfidence,
        suggestionId: id,
      },
      "telemetry scalar suggestion emitted",
    );
  }

  return suggestionIds;
}

async function findNullTelemetryColumns(
  db: Database,
  satelliteId: number,
): Promise<Set<string>> {
  const cols = Object.values(TELEMETRY_SCALAR_COLUMN);
  const selects = cols.map((c) => `"${c}" IS NULL AS "${c}"`).join(", ");
  const res = await db.execute(
    sql.raw(`SELECT ${selects} FROM satellite WHERE id = ${BigInt(satelliteId).toString()}::bigint LIMIT 1`),
  );
  const row = res.rows[0] as Record<string, boolean | null> | undefined;
  if (!row) return new Set();
  const out = new Set<string>();
  for (const c of cols) {
    if (row[c] === true) out.add(c);
  }
  return out;
}

/**
 * Severity + source_class from consensus strength. All telemetry inferences
 * start in the SIM_UNCORROBORATED band — promotion to OSINT_CORROBORATED
 * happens on reviewer accept via ConfidenceService.
 */
function scoreScalar(
  stats: { median: number; sigma: number; n: number },
  simConfidence: number,
): { severity: "critical" | "warning" | "info"; sourceClass: "SIM_UNCORROBORATED" } {
  const cv =
    Math.abs(stats.median) > 1e-9 ? stats.sigma / Math.abs(stats.median) : 1;
  // A reviewer should be pulled toward two patterns:
  //   1. Tight consensus (low cv) with reasonable sample + swarm confidence →
  //      a clean accept candidate.
  //   2. High dispersion (high cv) → fish dissent, worth investigating why.
  // Everything in between is background info.
  // We never emit "critical" for pure inference — critical is reserved for
  // field-corroborated alerts per SPEC-TH-040 I-4 (band cap SIM ≤ 0.35).
  let severity: "critical" | "warning" | "info" = "info";
  const enoughSamples = stats.n >= 5;
  const tightConsensus = cv < 0.20 && simConfidence >= 0.20 && enoughSamples;
  const highDispersion = cv >= 0.50 && enoughSamples;
  if (tightConsensus || highDispersion) severity = "warning";
  return { severity, sourceClass: "SIM_UNCORROBORATED" };
}

function round(n: number, digits: number): number {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}

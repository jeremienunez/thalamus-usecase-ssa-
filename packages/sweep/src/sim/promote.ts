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

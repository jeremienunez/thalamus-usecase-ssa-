import {
  researchCycle,
  researchCycleFinding,
  researchEdge,
  researchFinding,
} from "@interview/db-schema";
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
import { createLogger } from "@interview/shared/observability";
import type {
  SimPromoteInput,
  SimPromoteResult,
  SwarmAggregate,
  SweepRepository,
} from "@interview/sweep";
import { isKgPromotable } from "@interview/sweep/internal";
import type { SimSwarmRepository } from "../repositories/sim-swarm.repository";
import type { SatelliteRepository } from "../repositories/satellite.repository";
import type { TelemetryAggregate } from "../agent/ssa/sim/aggregators/telemetry";

const logger = createLogger("sim-promotion-service");

type SsaAction =
  | {
      kind: "maneuver";
      satelliteId: number;
      deltaVmps: number;
    }
  | {
      kind: "propose_split";
      ownShareDeltaV: number;
      counterpartyShareDeltaV: number;
    }
  | { kind: "accept" }
  | { kind: "reject" }
  | { kind: "launch"; satelliteCount: number; regimeId?: number | null }
  | { kind: "retire"; satelliteId: number }
  | { kind: "lobby"; policyTopic: string; stance: "support" | "oppose" }
  | { kind: "hold" };

export interface SimPromotionServiceDeps {
  store: SimPromotionStorePort;
  sweepRepo: Pick<SweepRepository, "insertGeneric">;
  satelliteRepo: Pick<
    SatelliteRepository,
    "findByIdFull" | "findNullTelemetryColumns"
  >;
  swarmRepo: Pick<SimSwarmRepository, "linkOutcome">;
  embed?: (text: string) => Promise<number[] | null>;
}

export interface SimPromotionStorePort {
  createCycle(
    value: typeof researchCycle.$inferInsert,
  ): Promise<{ id: bigint }>;
  createFinding(
    value: typeof researchFinding.$inferInsert,
  ): Promise<{ id: bigint }>;
  linkCycleFinding(
    value: typeof researchCycleFinding.$inferInsert,
  ): Promise<void>;
  createEdge(value: typeof researchEdge.$inferInsert): Promise<void>;
  updateCycleFindingsCount(
    cycleId: bigint,
    findingsCount: number,
  ): Promise<void>;
}

export class SimPromotionService {
  constructor(private readonly deps: SimPromotionServiceDeps) {}

  async promote(input: SimPromoteInput): Promise<SimPromoteResult> {
    const suggestionId = await this.deps.sweepRepo.insertGeneric({
      domain: "ssa",
      domainFields: {
        operatorCountryId: null,
        operatorCountryName: "sim-swarm",
        category: "relationship_error",
        severity: "warning",
        title: input.label,
        description:
          typeof input.evidence?.summary === "string"
            ? input.evidence.summary
            : input.label,
        affectedSatellites: 0,
        suggestedAction:
          typeof input.action.kind === "string"
            ? String(input.action.kind)
            : input.label,
        webEvidence: null,
      },
      resolutionPayload: null,
      simSwarmId: String(input.swarmId),
      simDistribution: JSON.stringify(input.distribution),
    });
    return { suggestionId };
  }

  async emitSuggestionFromModal(
    swarmId: number,
    aggregate: SwarmAggregate,
  ): Promise<number | null> {
    if (!aggregate.modal) return null;

    const modalAction = aggregate.modal.exemplarAction as SsaAction;
    const targetSatelliteId =
      modalAction.kind === "maneuver" || modalAction.kind === "retire"
        ? modalAction.satelliteId
        : null;

    let operatorCountryId: bigint | null = null;
    let operatorCountryName = "swarm-consensus";
    let operatorName: string | null = null;

    if (targetSatelliteId !== null) {
      const sat = await this.deps.satelliteRepo.findByIdFull(
        BigInt(targetSatelliteId),
      );
      if (sat) {
        operatorName = sat.operatorName;
        operatorCountryId = sat.operatorCountryId;
        if (sat.operatorCountryName) {
          operatorCountryName = sat.operatorCountryName;
        }
      }
    }

    const title = composeTitle(swarmId, aggregate);
    const description = composeDescription(aggregate, operatorName);
    const severity = aggregate.modal.fraction >= 0.8 ? "critical" : "warning";

    const cycleRow = await this.deps.store.createCycle({
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
      });

    let findingId: bigint | null = null;
    if (isKgPromotable(aggregate.modal.exemplarAction)) {
      const findingText = `${title}\n\n${description}`;
      const embedding = this.deps.embed
        ? await safeEmbed(this.deps.embed, findingText)
        : null;
      const urgency =
        aggregate.modal.fraction >= 0.8
          ? ResearchUrgency.Critical
          : ResearchUrgency.High;

      const findingRow = await this.deps.store.createFinding({
          researchCycleId: cycleRow.id,
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
              clusters: aggregate.clusters.map((cluster) => ({
                label: cluster.label,
                fraction: cluster.fraction,
                memberFishIndexes: cluster.memberFishIndexes,
              })),
              weight: aggregate.modal.fraction,
            },
          ],
          reasoning: description,
          confidence: aggregate.modal.fraction,
          impactScore: aggregate.modal.fraction,
          embedding: embedding ?? null,
        });
      findingId = findingRow.id;

      await this.deps.store.linkCycleFinding({
        researchCycleId: cycleRow.id,
        researchFindingId: findingId,
      });

      const targetEntity = actionTarget(modalAction);
      if (targetEntity) {
        await this.deps.store.createEdge({
          findingId,
          entityType: targetEntity.entityType,
          entityId: BigInt(targetEntity.entityId),
          relation: ResearchRelation.Affects,
          weight: 1,
          context: {
            swarmId,
            simRunId: aggregate.modal.exemplarSimRunId,
            source: "sim_swarm_modal",
          },
        });
      }

      await this.deps.store.updateCycleFindingsCount(cycleRow.id, 1);
    }

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
      clusters: aggregate.clusters.map((cluster) => ({
        label: cluster.label,
        fraction: Number(cluster.fraction.toFixed(4)),
        memberFishIndexes: cluster.memberFishIndexes,
        exemplarSimRunId: cluster.exemplarSimRunId,
        exemplarAction: cluster.exemplarAction,
      })),
      researchCycleId: Number(cycleRow.id),
      researchFindingId: findingId !== null ? Number(findingId) : null,
    });

    const resolutionPayload = JSON.stringify({
      kind: "sim_swarm_modal",
      swarmId,
      action: modalAction,
      researchFindingId: findingId !== null ? Number(findingId) : null,
    });

    const suggestionId = await this.deps.sweepRepo.insertGeneric({
      domain: "ssa",
      domainFields: {
        operatorCountryId,
        operatorCountryName,
        category: "relationship_error",
        severity,
        title,
        description,
        affectedSatellites: targetSatelliteId !== null ? 1 : 0,
        suggestedAction: describeAction(modalAction),
        webEvidence: null,
      },
      resolutionPayload,
      simSwarmId: String(swarmId),
      simDistribution,
    });

    logger.info(
      {
        swarmId,
        suggestionId,
        researchCycleId: Number(cycleRow.id),
        researchFindingId: findingId !== null ? Number(findingId) : null,
        modalKind: aggregate.modal.actionKind,
        modalFraction: aggregate.modal.fraction,
        targetSatelliteId,
      },
      "swarm modal emitted as sweep_suggestion + KG finding",
    );

    await this.deps.swarmRepo.linkOutcome(BigInt(swarmId), {
      suggestionId: BigInt(suggestionId),
      ...(findingId === null ? {} : { reportFindingId: findingId }),
    });

    return Number(suggestionId);
  }

  async emitTelemetrySuggestions(
    aggregate: TelemetryAggregate,
  ): Promise<number[]> {
    if (!aggregate.quorumMet) return [];

    const sat = await this.deps.satelliteRepo.findByIdFull(
      BigInt(aggregate.satelliteId),
    );
    if (!sat) return [];

    const nullColumns = await this.deps.satelliteRepo.findNullTelemetryColumns(
      BigInt(aggregate.satelliteId),
    );

    const suggestionIds: number[] = [];
    for (const [key, stats] of Object.entries(aggregate.scalars)) {
      if (!stats) continue;
      const column = telemetryColumn(key);
      if (column === null || !nullColumns.has(column)) continue;

      const { severity, sourceClass } = scoreScalar(
        { median: stats.median, sigma: stats.sigma, n: stats.n },
        aggregate.simConfidence,
      );
      const median = round(stats.median, 6);

      const simDistribution = JSON.stringify({
        swarmId: aggregate.swarmId,
        satelliteId: aggregate.satelliteId,
        scalar: key,
        column,
        stats: {
          median,
          mean: round(stats.mean, 6),
          sigma: round(stats.sigma, 6),
          min: round(stats.min, 6),
          max: round(stats.max, 6),
          n: stats.n,
          unit: stats.unit,
          avgFishConfidence: round(stats.avgFishConfidence, 4),
          values: stats.values.map((value) => round(value, 6)),
        },
        simConfidence: round(aggregate.simConfidence, 4),
        sourceClass,
      });

      const resolutionPayload = JSON.stringify({
        kind: "update_field",
        satelliteIds: [aggregate.satelliteId],
        field: column,
        value: median,
        provenance: {
          source: "sim_swarm_telemetry",
          swarmId: aggregate.swarmId,
          sourceClass,
        },
      });

      const suggestionId = await this.deps.sweepRepo.insertGeneric({
        domain: "ssa",
        domainFields: {
          operatorCountryId: sat.operatorCountryId,
          operatorCountryName: sat.operatorCountryName ?? "(no country)",
          category: "enrichment",
          severity,
          title: `Infer ${key} for ${sat.name} ~= ${round(stats.median, 3)} ${stats.unit}`,
          description: [
            `Multi-agent inference from bus datasheet prior + persona perturbations across ${stats.n} fish.`,
            "",
            `Median: ${round(stats.median, 3)} ${stats.unit} (sigma ${round(stats.sigma, 3)}, min ${round(stats.min, 3)}, max ${round(stats.max, 3)}).`,
            `Self-reported fish confidence: ${round(stats.avgFishConfidence, 2)}. Swarm confidence: ${round(aggregate.simConfidence, 2)}.`,
            "",
            `Source class: ${sourceClass}. This is an inference, not a measurement.`,
          ].join("\n"),
          affectedSatellites: 1,
          suggestedAction: `UPDATE satellite.${column} = ${median} ${stats.unit}`,
          webEvidence: null,
        },
        resolutionPayload,
        simSwarmId: String(aggregate.swarmId),
        simDistribution,
      });
      suggestionIds.push(Number(suggestionId));
    }

    if (suggestionIds.length > 0) {
      await this.deps.swarmRepo.linkOutcome(BigInt(aggregate.swarmId), {
        suggestionId: BigInt(suggestionIds[0]!),
      });
    }

    return suggestionIds;
  }
}

function telemetryColumn(key: string): string | null {
  switch (key) {
    case "powerDraw":
      return "power_draw";
    case "thermalMargin":
      return "thermal_margin";
    case "pointingAccuracy":
      return "pointing_accuracy";
    case "attitudeRate":
      return "attitude_rate";
    case "linkBudget":
      return "link_budget";
    case "dataRate":
      return "data_rate";
    case "payloadDuty":
      return "payload_duty";
    case "eclipseRatio":
      return "eclipse_ratio";
    default:
      return null;
  }
}

function actionTarget(
  action: SsaAction,
):
  | { entityType: ResearchEntityType.Satellite; entityId: number }
  | { entityType: ResearchEntityType.Operator; entityId: number }
  | null {
  switch (action.kind) {
    case "maneuver":
    case "retire":
      return {
        entityType: ResearchEntityType.Satellite,
        entityId: action.satelliteId,
      };
    default:
      return null;
  }
}

function composeTitle(swarmId: number, agg: SwarmAggregate): string {
  if (!agg.modal) return `Swarm ${swarmId}: no modal`;
  const pct = Math.round(agg.modal.fraction * 100);
  return `Swarm ${swarmId} consensus (${pct}% of ${agg.succeededFish}): ${describeAction(
    agg.modal.exemplarAction as SsaAction,
  )}`;
}

function composeDescription(
  agg: SwarmAggregate,
  operatorName: string | null,
): string {
  if (!agg.modal) return "Swarm produced no modal outcome.";
  const target = operatorName ? ` targeting ${operatorName}'s fleet` : "";
  const divergencePct = Math.round(agg.divergenceScore * 100);
  const clusterLines = agg.clusters
    .slice(0, 5)
    .map(
      (cluster) =>
        `  - ${Math.round(cluster.fraction * 100)}% ${cluster.label} (exemplar sim_run=${cluster.exemplarSimRunId})`,
    )
    .join("\n");
  return [
    `A UC3 conjunction-negotiation swarm${target} converged on "${describeAction(
      agg.modal.exemplarAction as SsaAction,
    )}" in ${Math.round(agg.modal.fraction * 100)}% of explored futures (n=${agg.succeededFish}, ${agg.failedFish} failed).`,
    "",
    `Divergence: ${divergencePct}% (${agg.clusters.length} clusters).`,
    "",
    "Distribution:",
    clusterLines,
  ].join("\n");
}

function describeAction(action: SsaAction): string {
  switch (action.kind) {
    case "maneuver":
      return `maneuver satellite #${action.satelliteId} (delta-v ~= ${action.deltaVmps.toFixed(1)} m/s)`;
    case "propose_split":
      return `propose split (own delta-v=${action.ownShareDeltaV.toFixed(0)} / counterparty=${action.counterpartyShareDeltaV.toFixed(0)})`;
    case "accept":
      return "accept counterparty proposal";
    case "reject":
      return "reject counterparty proposal";
    case "launch":
      return `launch +${action.satelliteCount}${action.regimeId ? ` into regime ${action.regimeId}` : ""}`;
    case "retire":
      return `retire satellite #${action.satelliteId}`;
    case "lobby":
      return `lobby ${action.policyTopic} (${action.stance})`;
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

function scoreScalar(
  stats: { median: number; sigma: number; n: number },
  simConfidence: number,
): { severity: "critical" | "warning" | "info"; sourceClass: "SIM_UNCORROBORATED" } {
  const cv =
    Math.abs(stats.median) > 1e-9 ? stats.sigma / Math.abs(stats.median) : 1;
  const enoughSamples = stats.n >= 5;
  const tightConsensus = cv < 0.2 && simConfidence >= 0.2 && enoughSamples;
  const highDispersion = cv >= 0.5 && enoughSamples;
  return {
    severity: tightConsensus || highDispersion ? "warning" : "info",
    sourceClass: "SIM_UNCORROBORATED",
  };
}

function round(n: number, digits: number): number {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}

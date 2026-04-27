import {
  ResearchCortex,
  ResearchCycleStatus,
  ResearchCycleTrigger,
  ResearchFindingType,
  ResearchRelation,
  ResearchStatus,
  ResearchUrgency,
} from "@interview/shared";
import { createLogger, stepLog } from "@interview/shared/observability";
import type { SwarmAggregate } from "@interview/sweep";
import { isKgPromotable } from "@interview/sweep/internal";
import {
  actionTarget,
  composeDescription,
  composeTitle,
  describeAction,
  type SsaAction,
} from "./sim-promotion-helpers";
import type {
  SimPromotionSatellitePort,
  SimPromotionResearchWriterPort,
  SimPromotionSwarmPort,
  SimSuggestionWritePort,
} from "./sim-promotion.types";

const logger = createLogger("modal-suggestion-composer");

export interface ModalSuggestionComposerDeps {
  writer: SimPromotionResearchWriterPort;
  sweepRepo: SimSuggestionWritePort;
  satelliteRepo: SimPromotionSatellitePort;
  swarmRepo: SimPromotionSwarmPort;
  embed?: (text: string) => Promise<number[] | null>;
}

export class ModalSuggestionComposer {
  constructor(private readonly deps: ModalSuggestionComposerDeps) {}

  async emitSuggestionFromModal(
    swarmId: number,
    aggregate: SwarmAggregate,
  ): Promise<number | null> {
    if (!aggregate.modal) {
      stepLog(logger, "suggestion.emit", "done", {
        swarmId,
        emitted: false,
        reason: "no modal outcome",
      });
      return null;
    }

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

    const cycleRow = await this.deps.writer.createCycle({
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

      const findingRow = await this.deps.writer.createFinding({
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

      await this.deps.writer.linkFindingToCycle({
        cycleId: cycleRow.id,
        findingId,
        iteration: 0,
        isDedupHit: false,
      });

      const targetEntity = actionTarget(modalAction);
      if (targetEntity) {
        await this.deps.writer.createEdges([
          {
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
          },
        ]);
      }

      await this.deps.writer.updateCycleFindingsCount(cycleRow.id, 1);
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

    stepLog(logger, "suggestion.emit", "done", {
      swarmId,
      suggestionId,
      researchCycleId: Number(cycleRow.id),
      researchFindingId: findingId !== null ? Number(findingId) : null,
      modalKind: aggregate.modal.actionKind,
      modalFraction: aggregate.modal.fraction,
      targetSatelliteId,
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
}

async function safeEmbed(
  embed: (text: string) => Promise<number[] | null>,
  text: string,
): Promise<number[] | null> {
  try {
    return await embed(text);
  } catch (err) {
    logger.warn({ err }, "embed failed in modal suggestion composer");
    return null;
  }
}

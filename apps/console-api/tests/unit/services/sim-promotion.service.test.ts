import { describe, expect, it, vi } from "vitest";
import { stepContextStore, type StepEvent } from "@interview/shared/observability";
import {
  ResearchCortex,
  ResearchCycleStatus,
  ResearchCycleTrigger,
  ResearchEntityType,
  ResearchFindingType,
  ResearchRelation,
  ResearchStatus,
} from "@interview/shared/enum";
import type { SwarmAggregate } from "@interview/sweep";
import { ModalSuggestionComposer } from "../../../src/services/modal-suggestion-composer.service";
import type { SimPromotionResearchWriterPort } from "../../../src/services/sim-promotion.types";

function buildAggregate(): SwarmAggregate {
  return {
    swarmId: 42,
    totalFish: 5,
    quorumMet: true,
    succeededFish: 4,
    failedFish: 1,
    clusters: [
      {
        label: "maneuver",
        fraction: 0.75,
        memberFishIndexes: [0, 1, 2],
        exemplarSimRunId: 77,
        exemplarAction: {
          kind: "maneuver",
          satelliteId: 123,
          deltaVmps: 4.2,
        },
        exemplarSummary: "maneuver satellite 123",
        centroid: null,
      },
    ],
    modal: {
      actionKind: "maneuver",
      fraction: 0.75,
      exemplarSimRunId: 77,
      exemplarAction: {
        kind: "maneuver",
        satelliteId: 123,
        deltaVmps: 4.2,
      },
    },
    divergenceScore: 0.25,
  };
}

describe("ModalSuggestionComposer.emitSuggestionFromModal", () => {
  it("links the promoted finding back to the emitted cycle through research_cycle_finding", async () => {
    const now = new Date("2026-04-28T00:00:00.000Z");
    const writer = {
      createCycle: vi.fn(async () => ({
        id: 101n,
        triggerType: ResearchCycleTrigger.System,
        triggerSource: "sim-modal",
        userId: null,
        dagPlan: null,
        corticesUsed: [ResearchCortex.ConjunctionAnalysis],
        status: ResearchCycleStatus.Completed,
        findingsCount: 0,
        totalCost: null,
        error: null,
        startedAt: now,
        completedAt: now,
      })),
      createFinding: vi.fn(async () => ({
        id: 202n,
        researchCycleId: 101n,
        cortex: ResearchCortex.ConjunctionAnalysis,
        findingType: ResearchFindingType.Strategy,
        status: ResearchStatus.Active,
        urgency: null,
        title: "Modal action consensus",
        summary: "Modal action consensus",
        evidence: [],
        reasoning: null,
        confidence: 0.75,
        impactScore: null,
        extensions: null,
        reflexionNotes: null,
        iteration: 0,
        dedupHash: null,
        embedding: null,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      })),
      linkFindingToCycle: vi.fn(async () => true),
      createEdges: vi.fn(async () => [
        {
          id: 404n,
          findingId: 202n,
          entityType: ResearchEntityType.Satellite,
          entityId: 123n,
          relation: ResearchRelation.About,
          weight: 1,
          context: null,
          createdAt: now,
        },
      ]),
      updateCycleFindingsCount: vi.fn(async () => undefined),
    } satisfies SimPromotionResearchWriterPort;
    const sweepRepo = {
      insertGeneric: vi.fn(async () => "303"),
    };
    const satelliteRepo = {
      findByIdFull: vi.fn(async () => ({
        id: 123n,
        name: "SAT-123",
        slug: "sat-123",
        noradId: null,
        launchYear: null,
        operatorName: "ACME Orbital",
        operatorId: 9n,
        operatorCountryName: "USA",
        operatorCountryId: 10n,
        platformClassName: null,
        platformClassId: null,
        orbitRegimeName: null,
        orbitRegimeId: null,
        busName: null,
        telemetrySummary: null,
      })),
      findNullTelemetryColumns: vi.fn(async () => new Set<string>()),
    };
    const swarmRepo = {
      linkOutcome: vi.fn(async () => undefined),
    };

    const service = new ModalSuggestionComposer({
      writer,
      sweepRepo,
      satelliteRepo,
      swarmRepo,
      embed: vi.fn(async () => [0.1, 0.2]),
    });

    const events: StepEvent[] = [];
    const suggestionId = await stepContextStore.run(
      { onStep: (event) => events.push(event) },
      () => service.emitSuggestionFromModal(42, buildAggregate()),
    );

    expect(suggestionId).toBe(303);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "suggestion.emit",
          phase: "done",
          swarmId: 42,
          suggestionId: "303",
          researchCycleId: 101,
          researchFindingId: 202,
        }),
      ]),
    );
    expect(writer.createCycle).toHaveBeenCalledOnce();
    expect(writer.createFinding).toHaveBeenCalledOnce();
    expect(writer.linkFindingToCycle).toHaveBeenCalledWith({
      cycleId: 101n,
      findingId: 202n,
      iteration: 0,
      isDedupHit: false,
    });
    expect(writer.createEdges).toHaveBeenCalledOnce();
    expect(writer.updateCycleFindingsCount).toHaveBeenCalledWith(101n, 1);
    expect(swarmRepo.linkOutcome).toHaveBeenCalledWith(42n, {
      suggestionId: 303n,
      reportFindingId: 202n,
    });
  });
});

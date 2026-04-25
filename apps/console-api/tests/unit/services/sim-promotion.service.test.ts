import { describe, expect, it, vi } from "vitest";
import { stepContextStore, type StepEvent } from "@interview/shared/observability";
import {
  researchCycle,
  researchCycleFinding,
  researchEdge,
  researchFinding,
} from "@interview/db-schema";
import type { SwarmAggregate } from "@interview/sweep";
import {
  SimPromotionService,
  type SimPromotionStorePort,
  type SimPromotionServiceDeps,
} from "../../../src/services/sim-promotion.service";

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

describe("SimPromotionService.emitSuggestionFromModal", () => {
  it("links the promoted finding back to the emitted cycle through research_cycle_finding", async () => {
    const store = {
      createCycle: vi.fn(async () => ({ id: 101n })),
      createFinding: vi.fn(async () => ({ id: 202n })),
      linkCycleFinding: vi.fn(async () => undefined),
      createEdge: vi.fn(async () => undefined),
      updateCycleFindingsCount: vi.fn(async () => undefined),
    } satisfies SimPromotionStorePort;
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

    const service = new SimPromotionService({
      store,
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
    expect(store.createCycle).toHaveBeenCalledOnce();
    expect(store.createFinding).toHaveBeenCalledOnce();
    expect(store.linkCycleFinding).toHaveBeenCalledWith({
      researchCycleId: 101n,
      researchFindingId: 202n,
    });
    expect(store.createEdge).toHaveBeenCalledOnce();
    expect(store.updateCycleFindingsCount).toHaveBeenCalledWith(101n, 1);
    expect(swarmRepo.linkOutcome).toHaveBeenCalledWith(42n, {
      suggestionId: 303n,
      reportFindingId: 202n,
    });
  });
});

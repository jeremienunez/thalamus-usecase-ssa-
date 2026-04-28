import { describe, expect, it } from "vitest";
import { typedSpy } from "@interview/test-kit";
import {
  SimRunService,
  type SimRunAgentCountPort,
  type SimRunStorePort,
  type SimRunTemporalSeedPort,
  type SimRunTurnCountPort,
} from "../../../src/services/sim-run.service";
import type { InsertSimRunInput } from "../../../src/types/sim-run.types";

describe("SimRunService", () => {
  it("links runs seeded by an accepted temporal pattern after run creation", async () => {
    const { service, runInsert, temporalInsert } = buildService();
    const input = runInput({
      seedApplied: {
        subjectIds: [7],
        seeded_by_pattern_id: "123",
      },
    });

    const simRunId = await service.create(input);

    expect(simRunId).toBe(44n);
    expect(runInsert).toHaveBeenCalledWith(input);
    expect(temporalInsert).toHaveBeenCalledWith({
      patternId: 123n,
      simRunId: 44n,
      seedReason: "followup_seeded_by_temporal_pattern",
      sourceDomain: "simulation_seeded",
    });
  });

  it("accepts camel-case temporal seed ids from internal callers", async () => {
    const { service, temporalInsert } = buildService();

    await service.create(
      runInput({
        seedApplied: {
          subjectIds: [7],
          seededByPatternId: 456,
        },
      }),
    );

    expect(temporalInsert).toHaveBeenCalledWith(
      expect.objectContaining({ patternId: 456n }),
    );
  });

  it("does not create a seeded-run link when the seed is absent or not a pattern row id", async () => {
    const { service, temporalInsert } = buildService();

    await service.create(runInput({ seedApplied: { subjectIds: [7] } }));
    await service.create(
      runInput({
        seedApplied: {
          subjectIds: [7],
          seeded_by_pattern_id: "pattern-hash-legacy",
        },
      }),
    );

    expect(temporalInsert).not.toHaveBeenCalled();
  });
});

function buildService(): {
  service: SimRunService;
  runInsert: ReturnType<typeof typedSpy<SimRunStorePort["insert"]>>;
  temporalInsert: ReturnType<typeof typedSpy<SimRunTemporalSeedPort["insert"]>>;
} {
  const runInsert = typedSpy<SimRunStorePort["insert"]>();
  runInsert.mockResolvedValue(44n);
  const runRepo: SimRunStorePort = {
    insert: runInsert,
    findById: typedSpy<SimRunStorePort["findById"]>(),
    updateStatus: typedSpy<SimRunStorePort["updateStatus"]>(),
    getSeedApplied: typedSpy<SimRunStorePort["getSeedApplied"]>(),
  };
  const agentRepo: SimRunAgentCountPort = {
    countForRun: typedSpy<SimRunAgentCountPort["countForRun"]>(),
  };
  const turnRepo: SimRunTurnCountPort = {
    countAgentTurnsForRun:
      typedSpy<SimRunTurnCountPort["countAgentTurnsForRun"]>(),
  };
  const temporalInsert = typedSpy<SimRunTemporalSeedPort["insert"]>();
  temporalInsert.mockResolvedValue(null);
  const temporalSeededRunRepo: SimRunTemporalSeedPort = {
    insert: temporalInsert,
  };

  return {
    service: new SimRunService(
      runRepo,
      agentRepo,
      turnRepo,
      temporalSeededRunRepo,
    ),
    runInsert,
    temporalInsert,
  };
}

function runInput(
  overrides: Partial<InsertSimRunInput> = {},
): InsertSimRunInput {
  return {
    swarmId: 1n,
    fishIndex: 0,
    kind: "uc_pc_estimator",
    seedApplied: { subjectIds: [7] },
    perturbation: { kind: "noop" },
    config: {
      turnsPerDay: 1,
      maxTurns: 8,
      llmMode: "fixtures",
      seed: 42,
      nanoModel: "stub",
    },
    status: "pending",
    ...overrides,
  };
}

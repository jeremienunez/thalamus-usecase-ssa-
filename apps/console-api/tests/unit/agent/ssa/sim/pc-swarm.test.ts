import { describe, expect, it, vi } from "vitest";
import { fakePort, typedSpy } from "@interview/test-kit";
import type { LaunchSwarmResult } from "@interview/sweep/internal";
import { startPcEstimatorSwarm } from "../../../../../src/agent/ssa/sim/swarms/pc";
import type { PcSwarmLaunchPort } from "../../../../../src/agent/ssa/sim/swarms/pc";
import type { ConjunctionWithSatellitesRow } from "../../../../../src/types/conjunction.types";

function mockConjunction(
  row: ConjunctionWithSatellitesRow | null,
) {
  return {
    findByIdWithSatellites: vi.fn(async () => row),
  };
}

function makeConjunction(): ConjunctionWithSatellitesRow {
  return {
    id: 7n,
    epoch: new Date("2026-04-25T00:00:00Z"),
    minRangeKm: 0.6,
    relativeVelocityKmps: 13.2,
    probabilityOfCollision: null,
    hardBodyRadiusM: null,
    combinedSigmaKm: null,
    primary: {
      id: 101n,
      name: "PrimarySat",
      noradId: 10001,
      busName: "SSL-1300",
      operatorId: 88n,
    },
    secondary: {
      id: 102n,
      name: "SecondarySat",
      noradId: 10002,
      busName: "A2100",
      operatorId: 89n,
    },
  };
}

function mockSwarmService() {
  const launchSwarm = typedSpy<PcSwarmLaunchPort["launchSwarm"]>()
    .mockResolvedValue({
      swarmId: 42,
      fishCount: 4,
      firstSimRunId: 100,
    } satisfies LaunchSwarmResult);
  return {
    swarmService: fakePort<PcSwarmLaunchPort>({ launchSwarm }),
    launchSwarm,
  };
}

describe("startPcEstimatorSwarm", () => {
  it("launches with a baseline control fish before assumption sweeps", async () => {
    const conjunctionRepo = mockConjunction(makeConjunction());
    const { swarmService, launchSwarm } = mockSwarmService();

    const result = await startPcEstimatorSwarm(
      { conjunctionRepo, swarmService },
      {
        conjunctionId: 7,
        fishCount: 4,
        config: {
          llmMode: "fixtures",
          quorumPct: 0.6,
          perFishTimeoutMs: 1000,
          fishConcurrency: 2,
          nanoModel: "stub",
          seed: 42,
        },
      },
    );

    expect(result).toMatchObject({ swarmId: 42, conjunctionId: 7 });
    const arg = launchSwarm.mock.calls[0]![0];
    expect(arg.kind).toBe("uc_pc_estimator");
    expect(arg.title).toBe("uc_pc_estimator:7");
    expect(arg.baseSeed).toMatchObject({
      subjectIds: [88],
      subjectKind: "operator",
      pcEstimatorTarget: 7,
    });
    expect(arg.perturbations).toHaveLength(4);
    expect(arg.perturbations[0]).toEqual({ kind: "noop" });
    expect(arg.perturbations[1]).toEqual({
      kind: "pc_assumptions",
      hardBodyRadiusMeters: 5,
      covarianceScale: "tight",
    });
    expect(arg.config.fishConcurrency).toBe(2);
  });

  it("keeps fishCount=1 as a baseline-only swarm", async () => {
    const conjunctionRepo = mockConjunction(makeConjunction());
    const { swarmService, launchSwarm } = mockSwarmService();

    await startPcEstimatorSwarm(
      { conjunctionRepo, swarmService },
      { conjunctionId: 7, fishCount: 1 },
    );

    const arg = launchSwarm.mock.calls[0]![0];
    expect(arg.perturbations).toEqual([{ kind: "noop" }]);
    expect(arg.config.fishConcurrency).toBe(1);
  });

  it("throws when the conjunction is not found", async () => {
    const conjunctionRepo = mockConjunction(null);
    const { swarmService } = mockSwarmService();

    await expect(
      startPcEstimatorSwarm(
        { conjunctionRepo, swarmService },
        { conjunctionId: 999_999 },
      ),
    ).rejects.toThrow(/Conjunction 999999 not found/);
  });
});

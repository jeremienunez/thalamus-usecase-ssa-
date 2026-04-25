/**
 * SPEC-SW-006 — startTelemetrySwarm entry point (unit).
 *
 * Asserts the helper resolves satellite → operator → bus → datasheet prior,
 * builds a valid base seed, and delegates to SwarmService.launchSwarm with
 * the right shape. The SwarmService is mocked — we don't boot BullMQ here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakePort, typedSpy } from "@interview/test-kit";
import { startTelemetrySwarm } from "../../../../../src/agent/ssa/sim/swarms/telemetry";
import { __resetBusDatasheetCache } from "../../../../../src/agent/ssa/sim/bus-datasheets/loader";
import type { LaunchSwarmResult } from "@interview/sweep/internal";
import type { FindByIdFullRow } from "../../../../../src/types/satellite.types";
import type { TelemetrySwarmLaunchPort } from "../../../../../src/agent/ssa/sim/swarms/telemetry";

beforeEach(() => {
  __resetBusDatasheetCache();
});

function hasBusDatasheetPrior(
  value: unknown,
): value is { busArchetype: string; scalars: Record<string, unknown> } {
  return (
    !!value &&
    typeof value === "object" &&
    "busArchetype" in value &&
    "scalars" in value
  );
}

function mockSatelliteRepo(sat: {
  id: number;
  name: string;
  operatorId: number | null;
  busName: string | null;
}) {
  return {
    findByIdFull: vi.fn(async (): Promise<FindByIdFullRow | null> =>
      sat
        ? ({
            id: BigInt(sat.id),
            name: sat.name,
            slug: null,
            noradId: null,
            launchYear: null,
            operatorName: null,
            operatorId: sat.operatorId === null ? null : BigInt(sat.operatorId),
            operatorCountryName: null,
            operatorCountryId: null,
            platformClassName: null,
            platformClassId: null,
            orbitRegimeName: null,
            orbitRegimeId: null,
            busName: sat.busName,
            telemetrySummary: null,
          } satisfies FindByIdFullRow)
        : null,
    ),
  };
}

function mockSwarmService() {
  const launch = typedSpy<TelemetrySwarmLaunchPort["launchSwarm"]>()
    .mockResolvedValue({
      swarmId: 42,
      fishCount: 5,
      firstSimRunId: 100,
    } satisfies LaunchSwarmResult);
  const svc = fakePort<TelemetrySwarmLaunchPort>({ launchSwarm: launch });
  return { svc, launch };
}

describe("startTelemetrySwarm", () => {
  it("resolves sat → operator → SSL-1300 datasheet → launches swarm", async () => {
    const satelliteRepo = mockSatelliteRepo({
      id: 1,
      name: "Intelsat 23",
      operatorId: 77,
      busName: "SSL-1300",
    });
    const { svc, launch } = mockSwarmService();

    const result = await startTelemetrySwarm(
      { satelliteRepo, swarmService: svc },
      { satelliteId: 1, fishCount: 5 },
    );
    expect(result.swarmId).toBe(42);
    expect(launch).toHaveBeenCalledOnce();

    const arg = launch.mock.calls[0]![0];

    expect(arg.kind).toBe("uc_telemetry_inference");
    expect(arg.title).toContain("Intelsat 23");
    expect(arg.baseSeed.subjectIds).toEqual([77]);
    expect(arg.baseSeed.subjectKind).toBe("operator");
    expect(arg.baseSeed.telemetryTargetSatelliteId).toBe(1);
    expect(hasBusDatasheetPrior(arg.baseSeed.busDatasheetPrior)).toBe(true);
    if (!hasBusDatasheetPrior(arg.baseSeed.busDatasheetPrior)) {
      throw new Error("expected busDatasheetPrior to be present");
    }
    expect(arg.baseSeed.busDatasheetPrior.busArchetype).toBe("SSL-1300");
    expect(Object.keys(arg.baseSeed.busDatasheetPrior.scalars)).toContain(
      "powerDraw",
    );
    expect(arg.perturbations.length).toBe(5);
    expect(arg.perturbations[0]).toEqual({ kind: "noop" });
  });

  it("launches with null busDatasheetPrior when bus is unknown", async () => {
    const satelliteRepo = mockSatelliteRepo({
      id: 2,
      name: "MysterySat-9000",
      operatorId: 99,
      busName: "TotallyUnknownBus",
    });
    const { svc, launch } = mockSwarmService();

    await startTelemetrySwarm(
      { satelliteRepo, swarmService: svc },
      { satelliteId: 2, fishCount: 3 },
    );

    const arg = launch.mock.calls[0]![0];
    expect(arg.baseSeed.busDatasheetPrior).toBeUndefined();
  });

  it("throws when the satellite is not found", async () => {
    const satelliteRepo = {
      findByIdFull: vi.fn(async (): Promise<FindByIdFullRow | null> => null),
    };
    const { svc } = mockSwarmService();

    await expect(
      startTelemetrySwarm(
        { satelliteRepo, swarmService: svc },
        { satelliteId: 999_999 },
      ),
    ).rejects.toThrow(/Satellite 999999 not found/);
  });

  it("throws when the satellite has no operator", async () => {
    const satelliteRepo = mockSatelliteRepo({
      id: 3,
      name: "Orphan-1",
      operatorId: null,
      busName: "A2100",
    });
    const { svc } = mockSwarmService();

    await expect(
      startTelemetrySwarm(
        { satelliteRepo, swarmService: svc },
        { satelliteId: 3 },
      ),
    ).rejects.toThrow(/not found \(or missing operator\)/);
  });

  it("personas span {conservative, balanced, aggressive} for K=5", async () => {
    const satelliteRepo = mockSatelliteRepo({
      id: 4,
      name: "Sentinel-2A",
      operatorId: 10,
      busName: "SSL-1300",
    });
    const { svc, launch } = mockSwarmService();
    await startTelemetrySwarm(
      { satelliteRepo, swarmService: svc },
      { satelliteId: 4, fishCount: 5 },
    );

    const arg = launch.mock.calls[0]![0];
    const profiles = arg.perturbations
      .map((p) => (typeof p.riskProfile === "string" ? p.riskProfile : null))
      .filter((p): p is string => !!p);
    expect(profiles).toContain("conservative");
    expect(profiles).toContain("balanced");
    expect(profiles).toContain("aggressive");
  });

  it("keeps fishCount=1 as a baseline-only swarm", async () => {
    const satelliteRepo = mockSatelliteRepo({
      id: 5,
      name: "BaselineSat",
      operatorId: 12,
      busName: "SSL-1300",
    });
    const { svc, launch } = mockSwarmService();

    await startTelemetrySwarm(
      { satelliteRepo, swarmService: svc },
      { satelliteId: 5, fishCount: 1 },
    );

    const arg = launch.mock.calls[0]![0];
    expect(arg.perturbations).toEqual([{ kind: "noop" }]);
    expect(arg.config.fishConcurrency).toBe(1);
  });
});

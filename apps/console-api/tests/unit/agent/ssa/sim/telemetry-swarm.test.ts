/**
 * SPEC-SW-006 — startTelemetrySwarm entry point (unit).
 *
 * Asserts the helper resolves satellite → operator → bus → datasheet prior,
 * builds a valid base seed, and delegates to SwarmService.launchSwarm with
 * the right shape. The SwarmService is mocked — we don't boot BullMQ here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { startTelemetrySwarm } from "../../../../../src/agent/ssa/sim/swarms/telemetry";
import { __resetBusDatasheetCache } from "../../../../../src/agent/ssa/sim/bus-datasheets/loader";
import type { SwarmService, LaunchSwarmResult } from "@interview/sweep";
import type { Database } from "@interview/db-schema";

beforeEach(() => {
  __resetBusDatasheetCache();
});

function mockDb(sat: {
  id: number;
  name: string;
  operator_id: number | null;
  bus_name: string | null;
}): Database {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: vi.fn(async () => ({ rows: sat ? [sat] : [] })) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function mockSwarmService() {
  const launch = vi.fn(
    async (_opts: unknown): Promise<LaunchSwarmResult> => ({
      swarmId: 42,
      fishCount: 5,
      firstSimRunId: 100,
    }),
  );
  const svc = { launchSwarm: launch } as unknown as SwarmService;
  return { svc, launch };
}

describe("startTelemetrySwarm", () => {
  it("resolves sat → operator → SSL-1300 datasheet → launches swarm", async () => {
    const db = mockDb({
      id: 1,
      name: "Intelsat 23",
      operator_id: 77,
      bus_name: "SSL-1300",
    });
    const { svc, launch } = mockSwarmService();

    const result = await startTelemetrySwarm(
      { db, swarmService: svc },
      { satelliteId: 1, fishCount: 5 },
    );
    expect(result.swarmId).toBe(42);
    expect(launch).toHaveBeenCalledOnce();

    const arg = launch.mock.calls[0]![0] as {
      kind: string;
      title: string;
      baseSeed: {
        operatorIds?: number[];
        telemetryTargetSatelliteId?: number;
        busDatasheetPrior?: { busArchetype: string; scalars: Record<string, unknown> };
      };
      perturbations: unknown[];
    };

    expect(arg.kind).toBe("uc_telemetry_inference");
    expect(arg.title).toContain("Intelsat 23");
    expect(arg.baseSeed.operatorIds).toEqual([77]);
    expect(arg.baseSeed.telemetryTargetSatelliteId).toBe(1);
    expect(arg.baseSeed.busDatasheetPrior?.busArchetype).toBe("SSL-1300");
    expect(Object.keys(arg.baseSeed.busDatasheetPrior?.scalars ?? {})).toContain("powerDraw");
    expect(arg.perturbations.length).toBe(5);
  });

  it("launches with null busDatasheetPrior when bus is unknown", async () => {
    const db = mockDb({
      id: 2,
      name: "MysterySat-9000",
      operator_id: 99,
      bus_name: "TotallyUnknownBus",
    });
    const { svc, launch } = mockSwarmService();

    await startTelemetrySwarm(
      { db, swarmService: svc },
      { satelliteId: 2, fishCount: 3 },
    );

    const arg = launch.mock.calls[0]![0] as {
      baseSeed: { busDatasheetPrior?: unknown };
    };
    expect(arg.baseSeed.busDatasheetPrior).toBeUndefined();
  });

  it("throws when the satellite is not found", async () => {
    const db = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: vi.fn(async () => ({ rows: [] })) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const { svc } = mockSwarmService();

    await expect(
      startTelemetrySwarm(
        { db, swarmService: svc },
        { satelliteId: 999_999 },
      ),
    ).rejects.toThrow(/Satellite 999999 not found/);
  });

  it("throws when the satellite has no operator", async () => {
    const db = mockDb({
      id: 3,
      name: "Orphan-1",
      operator_id: null,
      bus_name: "A2100",
    });
    const { svc } = mockSwarmService();

    await expect(
      startTelemetrySwarm({ db, swarmService: svc }, { satelliteId: 3 }),
    ).rejects.toThrow(/not found \(or missing operator\)/);
  });

  it("personas span {conservative, balanced, aggressive} for K=5", async () => {
    const db = mockDb({
      id: 4,
      name: "Sentinel-2A",
      operator_id: 10,
      bus_name: "SSL-1300",
    });
    const { svc, launch } = mockSwarmService();
    await startTelemetrySwarm({ db, swarmService: svc }, { satelliteId: 4, fishCount: 5 });

    const arg = launch.mock.calls[0]![0] as {
      perturbations: Array<{ kind: string; riskProfile?: string }>;
    };
    const profiles = arg.perturbations
      .map((p) => p.riskProfile)
      .filter((p): p is string => !!p);
    expect(profiles).toContain("conservative");
    expect(profiles).toContain("balanced");
    expect(profiles).toContain("aggressive");
  });
});

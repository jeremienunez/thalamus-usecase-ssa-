/**
 * Shared fakes + builders for SsaAuditProvider test files.
 *
 * Each test file in this folder targets ONE behavior axis. Fakes are
 * centralised here so every file uses the same narrow-typed seams —
 * making the ISP payoff visible (a port method added to
 * AuditSatellitePort fails to compile here first).
 */
import { vi } from "vitest";
import type {
  AuditSatellitePort,
  NullScanRow,
  OperatorCountrySweepStatsRow,
  SsaAuditDeps,
} from "../../../../../../src/agent/ssa/sweep/audit-provider.ssa";
import type {
  NanoCaller,
  NanoResponse,
} from "../../../../../../src/agent/ssa/sweep/nano-caller.port";
import type { AuditCycleContext } from "@interview/sweep";

export function fakeSatellitePort(
  overrides: Partial<AuditSatellitePort> = {},
): AuditSatellitePort {
  return {
    nullScanByColumn: vi.fn().mockResolvedValue([]),
    findSatelliteIdsWithNullColumn: vi.fn().mockResolvedValue([]),
    getOperatorCountrySweepStats: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

export function fakeSweepRepo(): SsaAuditDeps["sweepRepo"] {
  return { loadPastFeedback: vi.fn().mockResolvedValue([]) };
}

/** No-op caller; assert `.not.toHaveBeenCalled()` via the returned spy. */
export function makeEmptyCaller(): {
  caller: NanoCaller;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi
    .fn()
    .mockResolvedValue([] as Array<NanoResponse & { index: number }>);
  const caller: NanoCaller = {
    callWaves: spy as unknown as NanoCaller["callWaves"],
  };
  return { caller, spy };
}

export function ctxNullScan(
  overrides: Partial<AuditCycleContext> = {},
): AuditCycleContext {
  return { cycleId: "c1", mode: "nullScan", limit: 10, ...overrides };
}

export function nullRow(overrides: Partial<NullScanRow> = {}): NullScanRow {
  return {
    operatorCountryId: 42n,
    operatorCountryName: "Testland",
    column: "mass_kg",
    totalSatellites: 10,
    nullCount: 5,
    nullFraction: 0.5,
    ...overrides,
  };
}

export function statsRow(
  overrides: Partial<OperatorCountrySweepStatsRow> = {},
): OperatorCountrySweepStatsRow {
  return {
    operatorCountryId: 42n,
    operatorCountryName: "Testland",
    orbitRegimeName: "LEO",
    satelliteCount: 10,
    missingPayloads: 0,
    missingOrbitRegime: 0,
    missingLaunchYear: 0,
    missingMass: 0,
    hasDoctrine: true,
    avgMass: 250,
    topPayloads: ["payload_a"],
    sampleSatellites: [{ name: "Sat-1", massKg: 200, launchYear: 2020 }],
    ...overrides,
  };
}

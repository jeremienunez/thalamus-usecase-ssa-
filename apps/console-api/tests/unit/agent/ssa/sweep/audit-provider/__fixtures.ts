/**
 * Shared fakes + builders for SsaAuditProvider test files.
 *
 * Each test file in this folder targets ONE behavior axis. Fakes are
 * centralised here so every file uses the same narrow-typed seams —
 * making the ISP payoff visible (a port method added to
 * AuditSatellitePort fails to compile here first).
 *
 * Spy typing: `typedSpy<Fn>()` returns a Mock whose args and return
 * type match `Fn` exactly. Using it for spies whose *args* are later
 * asserted via `toHaveBeenCalledWith(...)` means that if the port
 * signature drifts (arg added/renamed, return shape changed), the
 * test fails to TYPECHECK rather than silently passing with the wrong
 * argument shape. Untyped `vi.fn()` gives `Mock<any[], any>` and
 * skips that validation.
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

/**
 * Create a mock whose Parameters/ReturnType are bound to `Fn`. Use this
 * for any spy that will later appear in a `toHaveBeenCalledWith(...)`
 * assertion — it propagates the port's real signature into the matcher.
 */
export function typedSpy<Fn extends (...args: never[]) => unknown>() {
  return vi.fn<Parameters<Fn>, ReturnType<Fn>>();
}

export function fakeSatellitePort(
  overrides: Partial<AuditSatellitePort> = {},
): AuditSatellitePort {
  const nullScanByColumn = typedSpy<AuditSatellitePort["nullScanByColumn"]>();
  const findSatelliteIdsWithNullColumn =
    typedSpy<AuditSatellitePort["findSatelliteIdsWithNullColumn"]>();
  const getOperatorCountrySweepStats =
    typedSpy<AuditSatellitePort["getOperatorCountrySweepStats"]>();
  nullScanByColumn.mockResolvedValue([]);
  findSatelliteIdsWithNullColumn.mockResolvedValue([]);
  getOperatorCountrySweepStats.mockResolvedValue([]);
  return {
    nullScanByColumn,
    findSatelliteIdsWithNullColumn,
    getOperatorCountrySweepStats,
    ...overrides,
  };
}

export function fakeSweepRepo(): SsaAuditDeps["sweepRepo"] {
  const loadPastFeedback =
    typedSpy<SsaAuditDeps["sweepRepo"]["loadPastFeedback"]>();
  loadPastFeedback.mockResolvedValue([]);
  return { loadPastFeedback };
}

/**
 * No-op NanoCaller. Exposes the raw `vi.fn()` spy for simple `.not
 * .toHaveBeenCalled()` assertions — arg typing isn't needed here since
 * the callWaves signature is generic and call-site assertions don't
 * inspect the forwarded args.
 */
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

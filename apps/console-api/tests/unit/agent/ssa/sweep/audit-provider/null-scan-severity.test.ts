/**
 * Behavior: nullScan severity mapping.
 *
 * The provider labels each null-scan row with a severity based on
 * nullFraction: >=0.5 critical, >=0.25 warning, else info. Fence-post
 * correctness matters — regressions at the exact boundary slip past
 * mid-bucket tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SsaAuditProvider } from "../../../../../../src/agent/ssa/sweep/audit-provider.ssa";
import {
  fakeSatellitePort,
  fakeSweepRepo,
  makeEmptyCaller,
  ctxNullScan,
  nullRow,
} from "./__fixtures";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SsaAuditProvider nullScan: severity boundaries", () => {
  it("returns [] when the repo yields no rows", async () => {
    // Why: baseline for the empty-state path. Catches a refactor that
    // accidentally throws or returns undefined on an empty input.
    const provider = new SsaAuditProvider({
      satelliteRepo: fakeSatellitePort(),
      sweepRepo: fakeSweepRepo(),
      nanoCaller: makeEmptyCaller().caller,
    });

    await expect(provider.runAudit(ctxNullScan())).resolves.toEqual([]);
  });

  it("maps exactly nullFraction=0.5 to severity=critical", async () => {
    // Why: fence-post on the `>= 0.5` comparison. Original suite tested 0.6
    // (mid-bucket) and would have passed a buggy `> 0.5`. We test the exact
    // boundary.
    const satelliteRepo = fakeSatellitePort({
      nullScanByColumn: vi
        .fn()
        .mockResolvedValue([nullRow({ nullFraction: 0.5, nullCount: 5 })]),
    });
    const provider = new SsaAuditProvider({
      satelliteRepo,
      sweepRepo: fakeSweepRepo(),
      nanoCaller: makeEmptyCaller().caller,
    });

    const [c] = await provider.runAudit(ctxNullScan());

    expect(c!.domainFields.severity).toBe("critical");
  });

  it("maps exactly nullFraction=0.25 to severity=warning", async () => {
    // Why: lower fence-post (`>= 0.25`). Without this, a `> 0.25` regression
    // slips through.
    const satelliteRepo = fakeSatellitePort({
      nullScanByColumn: vi
        .fn()
        .mockResolvedValue([nullRow({ nullFraction: 0.25, nullCount: 3 })]),
    });
    const provider = new SsaAuditProvider({
      satelliteRepo,
      sweepRepo: fakeSweepRepo(),
      nanoCaller: makeEmptyCaller().caller,
    });

    const [c] = await provider.runAudit(ctxNullScan());

    expect(c!.domainFields.severity).toBe("warning");
  });

  it("maps nullFraction=0.24 to severity=info", async () => {
    // Why: confirms the OTHER side of the 0.25 boundary. Without this, a
    // buggy `>= 0.24` would still pass the 0.25 test silently.
    const satelliteRepo = fakeSatellitePort({
      nullScanByColumn: vi
        .fn()
        .mockResolvedValue([nullRow({ nullFraction: 0.24, nullCount: 2 })]),
    });
    const provider = new SsaAuditProvider({
      satelliteRepo,
      sweepRepo: fakeSweepRepo(),
      nanoCaller: makeEmptyCaller().caller,
    });

    const [c] = await provider.runAudit(ctxNullScan());

    expect(c!.domainFields.severity).toBe("info");
  });
});

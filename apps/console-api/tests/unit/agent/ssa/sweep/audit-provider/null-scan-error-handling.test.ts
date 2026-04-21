/**
 * Behavior: nullScan error containment.
 *
 * A flaky repo call for one column must NOT abort the whole audit cycle.
 * The provider wraps findSatelliteIdsWithNullColumn with a .catch that
 * degrades to an empty id list. This file pins that resilience.
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

describe("SsaAuditProvider nullScan: error handling", () => {
  it("swallows findSatelliteIdsWithNullColumn failures and emits empty satelliteIds", async () => {
    // Why: production relies on `.catch((): bigint[] => [])` to keep a
    // single flaky column from aborting the whole cycle. Remove the catch
    // and this test fails.
    const satelliteRepo = fakeSatellitePort({
      nullScanByColumn: vi.fn().mockResolvedValue([nullRow()]),
      findSatelliteIdsWithNullColumn: vi
        .fn()
        .mockRejectedValue(new Error("repo boom")),
    });
    const provider = new SsaAuditProvider({
      satelliteRepo,
      sweepRepo: fakeSweepRepo(),
      nanoCaller: makeEmptyCaller().caller,
    });

    const [c] = await provider.runAudit(ctxNullScan());

    const payload = JSON.parse(c!.resolutionPayload!);
    expect(payload.actions[0].satelliteIds).toEqual([]);
  });
});

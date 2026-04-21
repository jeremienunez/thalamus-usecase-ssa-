/**
 * Behavior: recordFeedback — reviewer acceptance/rejection feedback path.
 *
 * Writes a normalised SweepFeedbackEntry to the feedbackRepo port. When
 * no repo is supplied the call must be a genuine no-op (no side effects
 * on the other ports, promise resolves cleanly).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SsaAuditProvider,
  type AuditFeedbackPort,
} from "../../../../../../src/agent/ssa/sweep/audit-provider.ssa";
import type { SweepFeedbackEntry } from "../../../../../../src/types/sweep.types";
import {
  fakeSatellitePort,
  fakeSweepRepo,
  makeEmptyCaller,
  typedSpy,
} from "./__fixtures";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SsaAuditProvider.recordFeedback", () => {
  it("pushes exactly once with the normalised feedback shape", async () => {
    // Why: the original test used toHaveBeenCalledWith which misses a loop
    // bug (push invoked twice). Asserting call count AND shape together
    // pins both regressions.
    // Typed spy so toHaveBeenCalledWith matches AuditFeedbackPort["push"]
    // args exactly — a drift in SweepFeedbackEntry fails typecheck here.
    const push = typedSpy<AuditFeedbackPort["push"]>();
    push.mockResolvedValue(undefined);
    const provider = new SsaAuditProvider({
      satelliteRepo: fakeSatellitePort(),
      sweepRepo: fakeSweepRepo(),
      feedbackRepo: { push },
      nanoCaller: makeEmptyCaller().caller,
    });

    await provider.recordFeedback!({
      suggestionId: "sugg-1",
      accepted: true,
      reviewerNote: "good call",
      domainFields: {
        category: "missing_data",
        operatorCountryName: "Testland",
      },
    });

    // The assertion shape is type-validated via `satisfies` — if
    // SweepFeedbackEntry ever drops, renames, or retypes a field, TS
    // breaks here. Vitest's own toHaveBeenCalledWith typing is too loose
    // to catch it (<E extends any[]>), so the annotation is what pins
    // behavior, not the mock's type parameter.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({
      category: "missing_data",
      wasAccepted: true,
      reviewerNote: "good call",
      operatorCountryName: "Testland",
    } satisfies SweepFeedbackEntry);
  });

  it("is a genuine no-op when feedbackRepo is absent (no side effect)", async () => {
    // Why: the original test only asserted `resolves.toBeUndefined()` — a
    // test that passes even if the method accidentally called other deps.
    // Here we also prove NO dep was touched.
    const nullScan = vi.fn().mockResolvedValue([]);
    const loadFeedback = vi.fn().mockResolvedValue([]);
    const { caller, spy: callWavesSpy } = makeEmptyCaller();
    const provider = new SsaAuditProvider({
      satelliteRepo: fakeSatellitePort({ nullScanByColumn: nullScan }),
      sweepRepo: { loadPastFeedback: loadFeedback },
      nanoCaller: caller,
    });

    await expect(
      provider.recordFeedback!({
        suggestionId: "sugg-1",
        accepted: true,
        reviewerNote: null,
        domainFields: {},
      }),
    ).resolves.toBeUndefined();

    expect(nullScan).not.toHaveBeenCalled();
    expect(loadFeedback).not.toHaveBeenCalled();
    expect(callWavesSpy).not.toHaveBeenCalled();
  });
});

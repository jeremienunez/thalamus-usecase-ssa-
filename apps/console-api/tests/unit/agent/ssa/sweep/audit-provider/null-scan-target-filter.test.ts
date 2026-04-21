/**
 * Behavior: nullScan target filtering + config plumbing.
 *
 * When a caller (typically a REPL verification child) narrows the scan
 * with AuditCycleContext.target, the provider must:
 *   - widen the repo scan to 500 operator-countries so pre-limiting
 *     cannot filter the targeted country out
 *   - drop rows whose operatorCountryId isn't in target.entityIds
 *   - forward target.columnHints to the repo query
 *   - honor config.nullScanMaxIdsPerSuggestion as the findSatelliteIds limit
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SsaAuditProvider,
  type AuditSatellitePort,
} from "../../../../../../src/agent/ssa/sweep/audit-provider.ssa";
import { StaticConfigProvider } from "@interview/shared/config";
import {
  fakeSatellitePort,
  fakeSweepRepo,
  makeEmptyCaller,
  ctxNullScan,
  nullRow,
  typedSpy,
} from "./__fixtures";

beforeEach(() => {
  vi.clearAllMocks();
});

// Options shapes pulled from the port so that a drift in arg names
// (e.g. maxOperatorCountries → countryLimit) breaks typecheck on the
// `satisfies` annotations below. Vitest 1.6's toHaveBeenCalledWith
// uses `<E extends any[]>` and won't flag it on its own.
type NullScanOpts = NonNullable<
  Parameters<AuditSatellitePort["nullScanByColumn"]>[0]
>;
type FindIdsOpts = Parameters<
  AuditSatellitePort["findSatelliteIdsWithNullColumn"]
>[0];

describe("SsaAuditProvider nullScan: target + plumbing", () => {
  it("filters rows to operator-country targets and widens maxOperatorCountries to 500", async () => {
    // Why: REPL verification children pass target.entityIds to narrow the
    // suggestion set. The provider must (a) drop rows whose operatorCountryId
    // isn't in the target set, and (b) switch the repo query to a broad 500
    // scan so pre-limiting can't pre-filter out the targeted country.
    const nullScanByColumn = typedSpy<
      AuditSatellitePort["nullScanByColumn"]
    >();
    nullScanByColumn.mockResolvedValue([
      nullRow({ operatorCountryId: 42n, operatorCountryName: "Testland" }),
      nullRow({ operatorCountryId: 99n, operatorCountryName: "Otherland" }),
    ]);
    const satelliteRepo = fakeSatellitePort({ nullScanByColumn });
    const provider = new SsaAuditProvider({
      satelliteRepo,
      sweepRepo: fakeSweepRepo(),
      nanoCaller: makeEmptyCaller().caller,
    });

    const result = await provider.runAudit(
      ctxNullScan({
        limit: 3, // target path must IGNORE this in favor of 500.
        target: { entityType: "operator_country", entityIds: ["42"] },
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.domainFields.operatorCountryId).toBe(42n);
    expect(nullScanByColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOperatorCountries: 500,
      } satisfies Partial<NullScanOpts>),
    );
  });

  it("propagates target.columnHints to the repo query", async () => {
    // Why: without this, a refactor could silently drop column hints and
    // scan every nullable column, blowing up cost for a narrow follow-up.
    const nullScanByColumn = typedSpy<
      AuditSatellitePort["nullScanByColumn"]
    >();
    nullScanByColumn.mockResolvedValue([]);
    const satelliteRepo = fakeSatellitePort({ nullScanByColumn });
    const provider = new SsaAuditProvider({
      satelliteRepo,
      sweepRepo: fakeSweepRepo(),
      nanoCaller: makeEmptyCaller().caller,
    });

    await provider.runAudit(
      ctxNullScan({ target: { columnHints: ["mass_kg", "launch_year"] } }),
    );

    expect(nullScanByColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: ["mass_kg", "launch_year"],
      } satisfies Partial<NullScanOpts>),
    );
  });

  it("uses config.nullScanMaxIdsPerSuggestion as the findSatelliteIds limit", async () => {
    // Why: this cap is runtime-tunable via NanoSweepConfig to keep Redis
    // payloads bounded. Hardcoding 200 in place of the config value would
    // silently pass every other test.
    const findSatelliteIdsWithNullColumn = typedSpy<
      AuditSatellitePort["findSatelliteIdsWithNullColumn"]
    >();
    findSatelliteIdsWithNullColumn.mockResolvedValue([1n, 2n, 3n]);
    const nullScanByColumn = typedSpy<
      AuditSatellitePort["nullScanByColumn"]
    >();
    nullScanByColumn.mockResolvedValue([nullRow()]);
    const satelliteRepo = fakeSatellitePort({
      nullScanByColumn,
      findSatelliteIdsWithNullColumn,
    });
    const provider = new SsaAuditProvider({
      satelliteRepo,
      sweepRepo: fakeSweepRepo(),
      nanoCaller: makeEmptyCaller().caller,
      config: new StaticConfigProvider({
        batchSize: 10,
        nullScanMaxIdsPerSuggestion: 3,
      }),
    });

    await provider.runAudit(ctxNullScan());

    expect(findSatelliteIdsWithNullColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 3,
      } satisfies Partial<FindIdsOpts>),
    );
  });
});

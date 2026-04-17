import { describe, it, expect, vi } from "vitest";
import { SsaAuditProvider } from "../../../../../src/agent/ssa/sweep/audit-provider.ssa";
import type { SsaAuditDeps } from "../../../../../src/agent/ssa/sweep/audit-provider.ssa";

function fakeSatelliteRepo(overrides: Partial<SsaAuditDeps["satelliteRepo"]> = {}) {
  return {
    nullScanByColumn: vi.fn().mockResolvedValue([]),
    findSatelliteIdsWithNullColumn: vi.fn().mockResolvedValue([]),
    getOperatorCountrySweepStats: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as SsaAuditDeps["satelliteRepo"];
}

function fakeSweepRepo() {
  return {
    loadPastFeedback: vi.fn().mockResolvedValue([]),
  } as unknown as SsaAuditDeps["sweepRepo"];
}

describe("SsaAuditProvider nullScan mode", () => {
  it("produces one AuditCandidate per operator-country × column with graduated severity", async () => {
    const satelliteRepo = fakeSatelliteRepo({
      nullScanByColumn: vi.fn().mockResolvedValue([
        {
          operatorCountryId: "42",
          operatorCountryName: "Testland",
          column: "mass_kg",
          totalSatellites: 100,
          nullCount: 60,
          nullFraction: 0.6,
        },
        {
          operatorCountryId: "42",
          operatorCountryName: "Testland",
          column: "launch_year",
          totalSatellites: 100,
          nullCount: 30,
          nullFraction: 0.3,
        },
        {
          operatorCountryId: "99",
          operatorCountryName: "Otherland",
          column: "operator_id",
          totalSatellites: 50,
          nullCount: 5,
          nullFraction: 0.1,
        },
      ]),
      findSatelliteIdsWithNullColumn: vi
        .fn()
        .mockResolvedValue([1n, 2n, 3n]),
    });
    const provider = new SsaAuditProvider({
      satelliteRepo,
      sweepRepo: fakeSweepRepo(),
    });

    const candidates = await provider.runAudit({
      cycleId: "c1",
      mode: "nullScan",
      limit: 10,
    });

    expect(candidates).toHaveLength(3);
    expect(candidates[0]!.domainFields).toMatchObject({
      operatorCountryName: "Testland",
      category: "missing_data",
      severity: "critical",
      affectedSatellites: 60,
    });
    expect(candidates[1]!.domainFields.severity).toBe("warning");
    expect(candidates[2]!.domainFields.severity).toBe("info");

    const payload = JSON.parse(candidates[0]!.resolutionPayload!);
    expect(payload.actions[0].kind).toBe("update_field");
    expect(payload.actions[0].field).toBe("mass_kg");
    expect(payload.actions[0].value).toBeNull();
    expect(payload.actions[0].satelliteIds).toEqual(["1", "2", "3"]);
  });

  it("returns [] when satelliteRepo.nullScanByColumn returns []", async () => {
    const provider = new SsaAuditProvider({
      satelliteRepo: fakeSatelliteRepo(),
      sweepRepo: fakeSweepRepo(),
    });
    const result = await provider.runAudit({
      cycleId: "c",
      mode: "nullScan",
      limit: 10,
    });
    expect(result).toEqual([]);
  });

  it("uses GCAT citation for mass_kg backfill", async () => {
    const satelliteRepo = fakeSatelliteRepo({
      nullScanByColumn: vi.fn().mockResolvedValue([
        {
          operatorCountryId: "1",
          operatorCountryName: "X",
          column: "mass_kg",
          totalSatellites: 10,
          nullCount: 5,
          nullFraction: 0.5,
        },
      ]),
    });
    const provider = new SsaAuditProvider({
      satelliteRepo,
      sweepRepo: fakeSweepRepo(),
    });
    const [c] = await provider.runAudit({
      cycleId: "c",
      mode: "nullScan",
      limit: 1,
    });
    expect(String(c!.domainFields.suggestedAction)).toMatch(/GCAT/);
  });

  it("routes operator-private telemetry columns to sim-fish citation", async () => {
    const satelliteRepo = fakeSatelliteRepo({
      nullScanByColumn: vi.fn().mockResolvedValue([
        {
          operatorCountryId: "1",
          operatorCountryName: "X",
          column: "power_draw",
          totalSatellites: 10,
          nullCount: 10,
          nullFraction: 1.0,
        },
      ]),
    });
    const provider = new SsaAuditProvider({
      satelliteRepo,
      sweepRepo: fakeSweepRepo(),
    });
    const [c] = await provider.runAudit({
      cycleId: "c",
      mode: "nullScan",
      limit: 1,
    });
    expect(String(c!.domainFields.suggestedAction)).toMatch(/sim-fish/);
    expect(String(c!.domainFields.suggestedAction)).toMatch(
      /SIM_UNCORROBORATED/,
    );
  });
});

describe("SsaAuditProvider.recordFeedback", () => {
  it("delegates to SweepFeedbackRepository.push with normalised shape", async () => {
    const feedbackRepo = {
      push: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new SsaAuditProvider({
      satelliteRepo: fakeSatelliteRepo(),
      sweepRepo: fakeSweepRepo(),
      feedbackRepo: feedbackRepo as never,
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

    expect(feedbackRepo.push).toHaveBeenCalledWith({
      category: "missing_data",
      wasAccepted: true,
      reviewerNote: "good call",
      operatorCountryName: "Testland",
    });
  });

  it("is a no-op when feedbackRepo is not supplied", async () => {
    const provider = new SsaAuditProvider({
      satelliteRepo: fakeSatelliteRepo(),
      sweepRepo: fakeSweepRepo(),
    });
    await expect(
      provider.recordFeedback!({
        suggestionId: "sugg-1",
        accepted: true,
        reviewerNote: null,
        domainFields: {},
      }),
    ).resolves.toBeUndefined();
  });
});

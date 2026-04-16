import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { MissionService, type SweepListProvider } from "../../../src/services/mission.service";
import type { SatelliteRepository } from "../../../src/repositories/satellite.repository";
import type { SweepAuditRepository } from "../../../src/repositories/sweep-audit.repository";
import type { NanoResearchService } from "../../../src/services/nano-research.service";
import type { EnrichmentFindingService } from "../../../src/services/enrichment-finding.service";
import type { NanoResult } from "../../../src/types";

function flushAsync(times = 8) {
  return (async () => {
    for (let i = 0; i < times; i++) await Promise.resolve();
  })();
}

async function settleMission() {
  await flushAsync();
  await vi.advanceTimersByTimeAsync(1_500);
  await flushAsync();
}

function okVote(
  value: string | number,
  confidence: number,
  source = "https://example.org/fact",
): NanoResult {
  return {
    ok: true,
    value,
    confidence,
    source,
    unit: "",
    reason: "",
  };
}

function failVote(reason: string): NanoResult {
  return {
    ok: false,
    value: null,
    confidence: 0,
    source: "",
    unit: "",
    reason,
  };
}

function mockSatellites(): SatelliteRepository {
  return {
    findPayloadNamesByIds: vi.fn(),
    updateField: vi.fn().mockResolvedValue(undefined),
  } as unknown as SatelliteRepository;
}

function mockAudit(): SweepAuditRepository {
  return {
    insertEnrichmentSuccess: vi.fn().mockResolvedValue(undefined),
  } as unknown as SweepAuditRepository;
}

function mockNano(): NanoResearchService {
  return {
    singleVote: vi.fn(),
    votesAgree: vi.fn(),
    summary: vi.fn((vote: NanoResult) => (vote.ok ? "ok" : vote.reason)),
  } as unknown as NanoResearchService;
}

function mockEnrichment(): EnrichmentFindingService {
  return {
    emit: vi.fn().mockResolvedValue(undefined),
  } as unknown as EnrichmentFindingService;
}

function mockSweepRepo(): SweepListProvider {
  return {
    list: vi.fn(),
  };
}

function mockLogger(): FastifyBaseLogger {
  const l = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => l,
    level: "info",
    silent: vi.fn(),
  };
  return l as unknown as FastifyBaseLogger;
}

describe("MissionService", () => {
  let satellites: SatelliteRepository;
  let audit: SweepAuditRepository;
  let nano: NanoResearchService;
  let enrichment: EnrichmentFindingService;
  let sweepRepo: SweepListProvider;
  let logger: FastifyBaseLogger;
  let svc: MissionService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
    satellites = mockSatellites();
    audit = mockAudit();
    nano = mockNano();
    enrichment = mockEnrichment();
    sweepRepo = mockSweepRepo();
    logger = mockLogger();
    svc = new MissionService(
      satellites,
      audit,
      nano,
      enrichment,
      sweepRepo,
      logger,
    );
  });

  afterEach(() => {
    svc.stop();
    vi.useRealTimers();
  });

  it("builds tasks only from valid pending suggestions and respects the per-suggestion cap", async () => {
    (sweepRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [
        { id: "skip-no-payload", operatorCountryName: "France", resolutionPayload: null },
        {
          id: "skip-unknown-country",
          operatorCountryName: "Other / Unknown",
          resolutionPayload: JSON.stringify({
            actions: [{ kind: "update_field", field: "lifetime", value: null, satelliteIds: ["1"] }],
          }),
        },
        {
          id: "skip-non-writable",
          operatorCountryName: "France",
          resolutionPayload: JSON.stringify({
            actions: [{ kind: "update_field", field: "thermal_margin", value: null, satelliteIds: ["1"] }],
          }),
        },
        {
          id: "skip-already-filled",
          operatorCountryName: "France",
          resolutionPayload: JSON.stringify({
            actions: [{ kind: "update_field", field: "lifetime", value: 12, satelliteIds: ["1"] }],
          }),
        },
        {
          id: "skip-malformed",
          operatorCountryName: "France",
          resolutionPayload: "{",
        },
        {
          id: "keep",
          operatorCountryName: "France",
          resolutionPayload: JSON.stringify({
            actions: [
              {
                kind: "update_field",
                field: "lifetime",
                value: null,
                satelliteIds: ["10", "11", "12"],
              },
            ],
          }),
        },
      ],
    });
    (satellites.findPayloadNamesByIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "10", name: "SAT-10", norad_id: "10010" },
      { id: "11", name: "SAT-11", norad_id: null },
    ]);
    (nano.singleVote as ReturnType<typeof vi.fn>).mockResolvedValue(okVote(12, 0.8));
    (nano.votesAgree as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const res = await svc.start({ maxSatsPerSuggestion: 2 });
    await settleMission();

    expect(sweepRepo.list).toHaveBeenCalledWith({ reviewed: false, limit: 300 });
    expect(satellites.findPayloadNamesByIds).toHaveBeenCalledTimes(1);
    expect(satellites.findPayloadNamesByIds).toHaveBeenCalledWith([10n, 11n]);
    expect(res.state.total).toBe(2);
    expect(svc.publicState().total).toBe(2);
  });

  it("refuses to start a second mission while one is already running", async () => {
    const never = new Promise<NanoResult>(() => undefined);
    (sweepRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [
        {
          id: "keep",
          operatorCountryName: "France",
          resolutionPayload: JSON.stringify({
            actions: [{ kind: "update_field", field: "lifetime", value: null, satelliteIds: ["10"] }],
          }),
        },
      ],
    });
    (satellites.findPayloadNamesByIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "10", name: "SAT-10", norad_id: "10010" },
    ]);
    (nano.singleVote as ReturnType<typeof vi.fn>).mockReturnValue(never);

    const first = await svc.start({ maxSatsPerSuggestion: 5 });
    const second = await svc.start({ maxSatsPerSuggestion: 5 });

    expect(first.state.running).toBe(true);
    expect(second.alreadyRunning).toBe(true);
    expect(second.state.running).toBe(true);
  });

  it("marks a task filled on agreeing votes and writes the enrichment side effects", async () => {
    (sweepRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [
        {
          id: "keep",
          operatorCountryName: "France",
          resolutionPayload: JSON.stringify({
            actions: [{ kind: "update_field", field: "lifetime", value: null, satelliteIds: ["42"] }],
          }),
        },
      ],
    });
    (satellites.findPayloadNamesByIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "42", name: "SAT-42", norad_id: "32958" },
    ]);
    (nano.singleVote as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(okVote("12 years", 0.8, "https://example.org/a"))
      .mockResolvedValueOnce(okVote("12", 0.9, "https://example.org/b"));
    (nano.votesAgree as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await svc.start({ maxSatsPerSuggestion: 5 });
    await settleMission();

    expect(satellites.updateField).toHaveBeenCalledWith(42n, "lifetime", 12);
    expect(audit.insertEnrichmentSuccess).toHaveBeenCalledWith({
      suggestionId: "mission:42:lifetime",
      operatorCountryName: "mission-fill",
      title: "Fill lifetime=12 on satellite 42",
      description: "",
      suggestedAction: "UPDATE satellite SET lifetime=12",
      affectedSatellites: 1,
      webEvidence: "https://example.org/a",
      resolutionPayload: {
        field: "lifetime",
        value: 12,
        source: "https://example.org/a",
      },
    });
    expect(enrichment.emit).toHaveBeenCalledWith({
      kind: "mission",
      satelliteId: "42",
      field: "lifetime",
      value: 12,
      confidence: 0.9,
      source: "https://example.org/a",
    });
    expect(svc.publicState()).toMatchObject({
      total: 1,
      completed: 1,
      filled: 1,
      unobtainable: 0,
      errors: 0,
    });
  });

  it("marks a task unobtainable when the two votes disagree", async () => {
    (sweepRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [
        {
          id: "keep",
          operatorCountryName: "France",
          resolutionPayload: JSON.stringify({
            actions: [{ kind: "update_field", field: "variant", value: null, satelliteIds: ["42"] }],
          }),
        },
      ],
    });
    (satellites.findPayloadNamesByIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "42", name: "SAT-42", norad_id: "32958" },
    ]);
    (nano.singleVote as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(okVote("Bus-A", 0.8))
      .mockResolvedValueOnce(okVote("Bus-B", 0.85));
    (nano.votesAgree as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await svc.start({ maxSatsPerSuggestion: 5 });
    await settleMission();

    expect(satellites.updateField).not.toHaveBeenCalled();
    expect(audit.insertEnrichmentSuccess).not.toHaveBeenCalled();
    expect(enrichment.emit).not.toHaveBeenCalled();
    expect(svc.publicState()).toMatchObject({
      completed: 1,
      filled: 0,
      unobtainable: 1,
      errors: 0,
    });
    expect(svc.publicState().recent[0]).toMatchObject({
      status: "unobtainable",
      error: "votes disagree: Bus-A vs Bus-B",
      source: "https://example.org/fact",
    });
  });

  it("marks a task error and logs when a write throws", async () => {
    (sweepRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [
        {
          id: "keep",
          operatorCountryName: "France",
          resolutionPayload: JSON.stringify({
            actions: [{ kind: "update_field", field: "variant", value: null, satelliteIds: ["42"] }],
          }),
        },
      ],
    });
    (satellites.findPayloadNamesByIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "42", name: "SAT-42", norad_id: "32958" },
    ]);
    (nano.singleVote as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(okVote("Block 5", 0.8))
      .mockResolvedValueOnce(okVote("Block 5", 0.82));
    (nano.votesAgree as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (satellites.updateField as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db offline"),
    );

    await svc.start({ maxSatsPerSuggestion: 5 });
    await settleMission();

    expect(logger.error).toHaveBeenCalledWith(
      { err: "db offline", taskId: "keep" },
      "mission task failed",
    );
    expect(audit.insertEnrichmentSuccess).not.toHaveBeenCalled();
    expect(enrichment.emit).not.toHaveBeenCalled();
    expect(svc.publicState()).toMatchObject({
      completed: 1,
      filled: 0,
      unobtainable: 0,
      errors: 1,
    });
    expect(svc.publicState().recent[0]).toMatchObject({
      status: "error",
      error: "db offline",
    });
  });

  it("keeps the task filled but skips writes when the numeric value is out of range", async () => {
    (sweepRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [
        {
          id: "keep",
          operatorCountryName: "France",
          resolutionPayload: JSON.stringify({
            actions: [{ kind: "update_field", field: "lifetime", value: null, satelliteIds: ["42"] }],
          }),
        },
      ],
    });
    (satellites.findPayloadNamesByIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "42", name: "SAT-42", norad_id: "32958" },
    ]);
    (nano.singleVote as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(okVote(99, 0.8))
      .mockResolvedValueOnce(okVote(99, 0.9));
    (nano.votesAgree as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await svc.start({ maxSatsPerSuggestion: 5 });
    await settleMission();

    expect(satellites.updateField).not.toHaveBeenCalled();
    expect(audit.insertEnrichmentSuccess).not.toHaveBeenCalled();
    expect(enrichment.emit).not.toHaveBeenCalled();
    expect(svc.publicState()).toMatchObject({
      completed: 1,
      filled: 1,
      unobtainable: 0,
      errors: 0,
    });
    expect(svc.publicState().recent[0]).toMatchObject({
      status: "filled",
      value: 99,
    });
  });
});

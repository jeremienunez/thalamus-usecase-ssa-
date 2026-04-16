import { describe, expect, it, vi } from "vitest";
import { KnnPropagationService } from "../../../src/services/knn-propagation.service";
import type { SatelliteRepository } from "../../../src/repositories/satellite.repository";
import type { SweepAuditRepository } from "../../../src/repositories/sweep-audit.repository";
import type { EnrichmentFindingService } from "../../../src/services/enrichment-finding.service";

function mockSatellites(): SatelliteRepository {
  return {
    listNullCandidatesForField: vi.fn(),
    knnNeighboursForField: vi.fn(),
    updateField: vi.fn().mockResolvedValue(undefined),
  } as unknown as SatelliteRepository;
}

function mockAudit(): SweepAuditRepository {
  return {
    insertEnrichmentSuccess: vi.fn().mockResolvedValue(undefined),
  } as unknown as SweepAuditRepository;
}

function mockEnrichment(): EnrichmentFindingService {
  return {
    emit: vi.fn().mockResolvedValue(undefined),
  } as unknown as EnrichmentFindingService;
}

describe("KnnPropagationService.propagate", () => {
  it("fills numeric targets when all neighbour values agree within 10 percent", async () => {
    const satellites = mockSatellites();
    const audit = mockAudit();
    const enrichment = mockEnrichment();
    (satellites.listNullCandidatesForField as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "42", name: "SAT-42" },
    ]);
    (satellites.knnNeighboursForField as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "10", value: 100, cos_distance: 0.1 },
      { id: "11", value: 105, cos_distance: 0.15 },
      { id: "12", value: 110, cos_distance: 0.2 },
    ]);

    const stats = await new KnnPropagationService(
      satellites,
      audit,
      enrichment,
    ).propagate({
      field: "mass_kg",
      k: 5,
      minSim: 0.75,
      limit: 10,
      dryRun: false,
    });

    expect(stats).toEqual({
      field: "mass_kg",
      k: 5,
      minSim: 0.75,
      attempted: 1,
      filled: 1,
      disagree: 0,
      tooFar: 0,
      outOfRange: 0,
      sampleFills: [
        {
          id: "42",
          name: "SAT-42",
          value: 105,
          neighbourIds: ["10", "11", "12"],
          cosSim: 0.9,
        },
      ],
    });
    expect(satellites.updateField).toHaveBeenCalledWith(42n, "mass_kg", 105);
    expect(audit.insertEnrichmentSuccess).toHaveBeenCalledWith({
      suggestionId: "knn:42:mass_kg",
      operatorCountryName: "knn-propagation",
      title: "KNN-fill mass_kg=105 on satellite 42",
      description: "",
      suggestedAction: "UPDATE satellite SET mass_kg=105 (knn)",
      affectedSatellites: 1,
      webEvidence: "knn_propagation:k=3,cosSim=0.900,neighbours=[10,11,12]",
      resolutionPayload: {
        field: "mass_kg",
        value: 105,
        source: "knn_propagation:k=3,cosSim=0.900,neighbours=[10,11,12]",
        neighbourIds: ["10", "11", "12"],
        cosSim: 0.9,
      },
    });
    expect(enrichment.emit).toHaveBeenCalledWith({
      kind: "knn",
      satelliteId: "42",
      field: "mass_kg",
      value: 105,
      confidence: 0.9,
      source: "knn_propagation:k=3,cosSim=0.900,neighbours=[10,11,12]",
      neighbourIds: ["10", "11", "12"],
      cosSim: 0.9,
    });
  });

  it("fills text targets when a value reaches the two-thirds majority threshold", async () => {
    const satellites = mockSatellites();
    const audit = mockAudit();
    const enrichment = mockEnrichment();
    (satellites.listNullCandidatesForField as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "42", name: "SAT-42" },
    ]);
    (satellites.knnNeighboursForField as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "10", value: "  bus-a ", cos_distance: 0.05 },
      { id: "11", value: "BUS-A", cos_distance: 0.08 },
      { id: "12", value: "bus-b", cos_distance: 0.09 },
    ]);

    const stats = await new KnnPropagationService(
      satellites,
      audit,
      enrichment,
    ).propagate({
      field: "variant",
      k: 5,
      minSim: 0.7,
      limit: 10,
      dryRun: true,
    });

    expect(stats).toMatchObject({
      attempted: 1,
      filled: 1,
      disagree: 0,
      tooFar: 0,
      outOfRange: 0,
      sampleFills: [
        {
          id: "42",
          value: "bus-a",
          cosSim: 0.95,
        },
      ],
    });
    expect(satellites.updateField).not.toHaveBeenCalled();
    expect(audit.insertEnrichmentSuccess).not.toHaveBeenCalled();
    expect(enrichment.emit).not.toHaveBeenCalled();
  });

  it("counts targets as tooFar when there are fewer than three neighbours or the nearest one is below minSim", async () => {
    const satellites = mockSatellites();
    const audit = mockAudit();
    const enrichment = mockEnrichment();
    (satellites.listNullCandidatesForField as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "42", name: "SAT-42" },
      { id: "43", name: "SAT-43" },
    ]);
    (satellites.knnNeighboursForField as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { id: "10", value: 100, cos_distance: 0.1 },
        { id: "11", value: 105, cos_distance: 0.2 },
      ])
      .mockResolvedValueOnce([
        { id: "20", value: 100, cos_distance: 0.45 },
        { id: "21", value: 101, cos_distance: 0.46 },
        { id: "22", value: 99, cos_distance: 0.47 },
      ]);

    const stats = await new KnnPropagationService(
      satellites,
      audit,
      enrichment,
    ).propagate({
      field: "power",
      k: 5,
      minSim: 0.7,
      limit: 10,
      dryRun: false,
    });

    expect(stats).toMatchObject({
      attempted: 2,
      filled: 0,
      disagree: 0,
      tooFar: 2,
      outOfRange: 0,
      sampleFills: [],
    });
    expect(satellites.updateField).not.toHaveBeenCalled();
  });

  it("tracks out-of-range neighbours and falls back to tooFar when fewer than three valid values remain", async () => {
    const satellites = mockSatellites();
    const audit = mockAudit();
    const enrichment = mockEnrichment();
    (satellites.listNullCandidatesForField as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "42", name: "SAT-42" },
    ]);
    (satellites.knnNeighboursForField as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "10", value: 12, cos_distance: 0.05 },
      { id: "11", value: 14, cos_distance: 0.06 },
      { id: "12", value: 99, cos_distance: 0.07 },
    ]);

    const stats = await new KnnPropagationService(
      satellites,
      audit,
      enrichment,
    ).propagate({
      field: "lifetime",
      k: 5,
      minSim: 0.7,
      limit: 10,
      dryRun: false,
    });

    expect(stats).toMatchObject({
      attempted: 1,
      filled: 0,
      disagree: 0,
      tooFar: 1,
      outOfRange: 1,
    });
    expect(satellites.updateField).not.toHaveBeenCalled();
  });

  it("counts numeric consensus misses as disagree", async () => {
    const satellites = mockSatellites();
    const audit = mockAudit();
    const enrichment = mockEnrichment();
    (satellites.listNullCandidatesForField as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "42", name: "SAT-42" },
    ]);
    (satellites.knnNeighboursForField as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "10", value: 100, cos_distance: 0.05 },
      { id: "11", value: 100, cos_distance: 0.06 },
      { id: "12", value: 130, cos_distance: 0.07 },
    ]);

    const stats = await new KnnPropagationService(
      satellites,
      audit,
      enrichment,
    ).propagate({
      field: "mass_kg",
      k: 5,
      minSim: 0.7,
      limit: 10,
      dryRun: false,
    });

    expect(stats).toMatchObject({
      attempted: 1,
      filled: 0,
      disagree: 1,
      tooFar: 0,
      outOfRange: 0,
    });
    expect(satellites.updateField).not.toHaveBeenCalled();
  });
});

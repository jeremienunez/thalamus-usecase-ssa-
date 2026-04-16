import { describe, expect, it, vi } from "vitest";
import { ReflexionService } from "../../../src/services/reflexion.service";
import type {
  ReflexionRepository,
  CoplaneRow,
  BeltRow,
  MilRow,
  ReflexionTarget,
} from "../../../src/repositories/reflexion.repository";
import type { EnrichmentCycleRepository } from "../../../src/repositories/enrichment-cycle.repository";
import type { FindingRepository } from "../../../src/repositories/finding.repository";
import type { ResearchEdgeRepository } from "../../../src/repositories/research-edge.repository";
import { HttpError } from "../../../src/utils/http-error";

function target(overrides: Partial<ReflexionTarget> = {}): ReflexionTarget {
  return {
    id: "42",
    name: "FENGYUN 3A",
    object_class: "payload",
    operator_country: "China",
    classification_tier: "restricted",
    platform_name: "Imaging",
    inc: 98.5,
    raan: 122.2,
    mm: 14.2,
    ma: 180,
    apogee: 840,
    perigee: 820,
    ...overrides,
  };
}

function strictRow(overrides: Partial<CoplaneRow> = {}): CoplaneRow {
  return {
    id: "101",
    norad_id: "50001",
    name: "YAOGAN-101",
    operator_country: "China",
    tier: "restricted",
    object_class: "payload",
    platform: "ISR",
    d_inc: 0.1234,
    d_raan: 1.234,
    lag_min: 15.67,
    ...overrides,
  };
}

function beltRow(overrides: Partial<BeltRow> = {}): BeltRow {
  return {
    country: "China",
    tier: "restricted",
    object_class: "payload",
    n: "3",
    ...overrides,
  };
}

function milRow(overrides: Partial<MilRow> = {}): MilRow {
  return {
    id: "201",
    norad_id: "60001",
    name: "YAOGAN-201",
    country: "China",
    tier: "restricted",
    d_inc: 0.0456,
    ...overrides,
  };
}

function mockRepo(): ReflexionRepository {
  return {
    findTarget: vi.fn(),
    findStrictCoplane: vi.fn(),
    findInclinationBelt: vi.fn(),
    findMilLineagePeers: vi.fn(),
  } as unknown as ReflexionRepository;
}

function mockCycles(): EnrichmentCycleRepository {
  return {
    getOrCreate: vi.fn(),
  } as unknown as EnrichmentCycleRepository;
}

function mockFindings(): FindingRepository {
  return {
    insert: vi.fn(),
  } as unknown as FindingRepository;
}

function mockEdges(): ResearchEdgeRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
  } as unknown as ResearchEdgeRepository;
}

describe("ReflexionService.runPass", () => {
  it("throws notFound when the target satellite is missing", async () => {
    const repo = mockRepo();
    (repo.findTarget as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      new ReflexionService(repo, mockCycles(), mockFindings(), mockEdges()).runPass({
        noradId: 32958,
        dIncMax: 0.3,
        dRaanMax: 5,
        dMmMax: 0.05,
      }),
    ).rejects.toMatchObject<HttpError>({
      statusCode: 404,
      message: "satellite not found",
    });
  });

  it("throws badRequest when the target lacks orbital elements", async () => {
    const repo = mockRepo();
    (repo.findTarget as ReturnType<typeof vi.fn>).mockResolvedValue(
      target({ inc: null }),
    );

    await expect(
      new ReflexionService(repo, mockCycles(), mockFindings(), mockEdges()).runPass({
        noradId: 32958,
        dIncMax: 0.3,
        dRaanMax: 5,
        dMmMax: 0.05,
      }),
    ).rejects.toMatchObject<HttpError>({
      statusCode: 400,
      message: "target missing orbital elements",
    });
  });

  it("returns formatted reflexion data without emitting a finding when there is no anomaly trigger", async () => {
    const repo = mockRepo();
    const cycles = mockCycles();
    const findings = mockFindings();
    const edges = mockEdges();
    (repo.findTarget as ReturnType<typeof vi.fn>).mockResolvedValue(
      target({ operator_country: "France" }),
    );
    (repo.findStrictCoplane as ReturnType<typeof vi.fn>).mockResolvedValue([
      strictRow(),
    ]);
    (repo.findInclinationBelt as ReturnType<typeof vi.fn>).mockResolvedValue([
      beltRow({ country: "France", n: "2" }),
      beltRow({ country: "Germany", n: "1" }),
    ]);
    (repo.findMilLineagePeers as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await new ReflexionService(
      repo,
      cycles,
      findings,
      edges,
    ).runPass({
      noradId: 32958,
      dIncMax: 0.3,
      dRaanMax: 5,
      dMmMax: 0.05,
    });

    expect(result).toEqual({
      target: {
        noradId: 32958,
        name: "FENGYUN 3A",
        declared: {
          operator_country: "France",
          classification_tier: "restricted",
          object_class: "payload",
          platform: "Imaging",
        },
        orbital: {
          inclinationDeg: 98.5,
          raanDeg: 122.2,
          meanMotionRevPerDay: 14.2,
          apogeeKm: 840,
          perigeeKm: 820,
        },
      },
      strictCoplane: [
        {
          noradId: 50001,
          name: "YAOGAN-101",
          country: "China",
          tier: "restricted",
          class: "payload",
          platform: "ISR",
          dInc: 0.123,
          dRaan: 1.23,
          lagMin: 15.7,
        },
      ],
      beltByCountry: [
        {
          country: "France",
          tier: "restricted",
          class: "payload",
          n: 2,
        },
        {
          country: "Germany",
          tier: "restricted",
          class: "payload",
          n: 1,
        },
      ],
      milLineagePeers: [],
      findingId: null,
    });
    expect(cycles.getOrCreate).not.toHaveBeenCalled();
    expect(findings.insert).not.toHaveBeenCalled();
    expect(edges.insert).not.toHaveBeenCalled();
  });

  it("emits a high-urgency finding when MIL-lineage peers are present", async () => {
    const repo = mockRepo();
    const cycles = mockCycles();
    const findings = mockFindings();
    const edges = mockEdges();
    (repo.findTarget as ReturnType<typeof vi.fn>).mockResolvedValue(target());
    (repo.findStrictCoplane as ReturnType<typeof vi.fn>).mockResolvedValue([
      strictRow(),
      strictRow({ id: "102", norad_id: "50002", name: "YAOGAN-102", d_inc: 0.2, d_raan: 2.2, lag_min: 20.1 }),
    ]);
    (repo.findInclinationBelt as ReturnType<typeof vi.fn>).mockResolvedValue([
      beltRow({ country: "China", n: "4" }),
    ]);
    (repo.findMilLineagePeers as ReturnType<typeof vi.fn>).mockResolvedValue([
      milRow(),
    ]);
    (cycles.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue(77n);
    (findings.insert as ReturnType<typeof vi.fn>).mockResolvedValue(501n);

    const result = await new ReflexionService(
      repo,
      cycles,
      findings,
      edges,
    ).runPass({
      noradId: 32958,
      dIncMax: 0.3,
      dRaanMax: 5,
      dMmMax: 0.05,
    });

    expect(result.findingId).toBe("501");
    expect(findings.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        cycleId: 77n,
        cortex: "classification_auditor",
        findingType: "anomaly",
        urgency: "high",
        title:
          "Orbital anomaly · FENGYUN 3A shares inclination with 1 military-lineage peer(s)",
        confidence: 0.8,
        impactScore: 0.7,
      }),
    );
    expect(edges.insert).toHaveBeenCalledTimes(4);
    expect(edges.insert).toHaveBeenNthCalledWith(1, {
      findingId: 501n,
      entityType: "satellite",
      entityId: 42n,
      relation: "about",
      weight: 1,
      context: {
        noradId: 32958,
        declared: {
          operator_country: "China",
          tier: "restricted",
          object_class: "payload",
        },
      },
    });
    expect(edges.insert).toHaveBeenNthCalledWith(2, {
      findingId: 501n,
      entityType: "satellite",
      entityId: 201n,
      relation: "similar_to",
      weight: 0.9,
      context: { role: "mil_lineage_peer", dInc: 0.046 },
    });
  });

  it("emits a medium-urgency finding when the inclination belt is dominated by another country", async () => {
    const repo = mockRepo();
    const cycles = mockCycles();
    const findings = mockFindings();
    const edges = mockEdges();
    (repo.findTarget as ReturnType<typeof vi.fn>).mockResolvedValue(
      target({ operator_country: "France" }),
    );
    (repo.findStrictCoplane as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (repo.findInclinationBelt as ReturnType<typeof vi.fn>).mockResolvedValue([
      beltRow({ country: "China", n: "5" }),
      beltRow({ country: "France", n: "1" }),
    ]);
    (repo.findMilLineagePeers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (cycles.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue(77n);
    (findings.insert as ReturnType<typeof vi.fn>).mockResolvedValue(601n);

    const result = await new ReflexionService(
      repo,
      cycles,
      findings,
      edges,
    ).runPass({
      noradId: 32958,
      dIncMax: 0.3,
      dRaanMax: 5,
      dMmMax: 0.05,
    });

    expect(result.findingId).toBe("601");
    expect(findings.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        urgency: "medium",
        title:
          "Orbital anomaly · FENGYUN 3A inclination-belt dominated by China (declared France)",
      }),
    );
    expect(edges.insert).toHaveBeenCalledTimes(1);
    expect(edges.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        findingId: 601n,
        relation: "about",
        entityId: 42n,
      }),
    );
  });
});

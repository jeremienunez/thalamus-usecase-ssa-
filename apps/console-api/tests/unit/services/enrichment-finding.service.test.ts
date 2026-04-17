import { describe, expect, it, vi } from "vitest";
import { EnrichmentFindingService } from "../../../src/services/enrichment-finding.service";
import type { EnrichmentCycleRepository } from "../../../src/repositories/enrichment-cycle.repository";
import type { FindingRepository } from "../../../src/repositories/finding.repository";
import type { ResearchEdgeRepository } from "../../../src/repositories/research-edge.repository";

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
    insert: vi.fn(),
  } as unknown as ResearchEdgeRepository;
}

// EnrichmentFindingService now depends on a SweepFeedbackPort whose only
// method is `push(entry)` — Redis lpush/ltrim moved into the
// SweepFeedbackRepository implementation. Tests mock the port directly.
function mockFeedback() {
  return {
    push: vi.fn().mockResolvedValue(undefined),
  };
}

describe("EnrichmentFindingService.emit", () => {
  it("emits the KNN branch with an about edge, capped neighbour edges, and feedback", async () => {
    const cycles = mockCycles();
    const findings = mockFindings();
    const edges = mockEdges();
    const feedback = mockFeedback();
    (cycles.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue(77n);
    (findings.insert as ReturnType<typeof vi.fn>).mockResolvedValue(501n);

    await new EnrichmentFindingService(
      cycles,
      findings,
      edges,
      feedback,
    ).emit({
      kind: "knn",
      satelliteId: "42",
      field: "lifetime",
      value: 12,
      confidence: 0.81,
      source: "knn://ignored",
      neighbourIds: Array.from({ length: 12 }, (_, i) => String(100 + i)),
      cosSim: 0.934,
    });

    expect(findings.insert).toHaveBeenCalledWith({
      cycleId: 77n,
      cortex: "data_auditor",
      findingType: "insight",
      urgency: "low",
      title: "KNN fill · lifetime=12",
      summary:
        "lifetime propagated to satellite #42 from 12 semantically similar payloads (cos_sim=0.934).",
      evidence: [
        {
          source: "knn",
          data: {
            field: "lifetime",
            value: 12,
            cosSim: 0.934,
            neighbours: Array.from({ length: 12 }, (_, i) => String(100 + i)),
          },
          weight: 0.81,
        },
      ],
      reasoning:
        "Zero-LLM propagation: median consensus of K=12 nearest payloads in Voyage halfvec(2048) space.",
      confidence: 0.81,
      impactScore: 0.3,
    });

    expect(edges.insert).toHaveBeenCalledTimes(11);
    expect(edges.insert).toHaveBeenNthCalledWith(1, {
      findingId: 501n,
      entityType: "satellite",
      entityId: 42n,
      relation: "about",
      weight: 1,
      context: { field: "lifetime", value: "12" },
    });
    expect(edges.insert).toHaveBeenNthCalledWith(11, {
      findingId: 501n,
      entityType: "satellite",
      entityId: 109n,
      relation: "similar_to",
      weight: 0.934,
      context: { role: "knn_neighbour", cosSim: 0.934 },
    });

    expect(feedback.push).toHaveBeenCalledWith({
      category: "enrichment",
      wasAccepted: true,
      reviewerNote: "knn-fill: lifetime=12",
      operatorCountryName: "knn-propagation",
    });
  });

  it("emits the mission branch with web evidence and no neighbour edges", async () => {
    const cycles = mockCycles();
    const findings = mockFindings();
    const edges = mockEdges();
    const feedback = mockFeedback();
    (cycles.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue(88n);
    (findings.insert as ReturnType<typeof vi.fn>).mockResolvedValue(502n);

    await new EnrichmentFindingService(
      cycles,
      findings,
      edges,
      feedback,
    ).emit({
      kind: "mission",
      satelliteId: "7",
      field: "operator",
      value: "CNES",
      confidence: 0.92,
      source: "https://example.org/fact-sheet",
    });

    expect(findings.insert).toHaveBeenCalledWith({
      cycleId: 88n,
      cortex: "data_auditor",
      findingType: "insight",
      urgency: "low",
      title: "Mission fill · operator=CNES",
      summary:
        "operator written to satellite #7 from web-search source (confidence=0.92).",
      evidence: [
        {
          source: "web",
          data: {
            field: "operator",
            value: "CNES",
            url: "https://example.org/fact-sheet",
          },
          weight: 0.92,
        },
      ],
      reasoning:
        "Web-mission 2-vote corroboration: two independent nano calls agreed on this value from https://example.org/fact-sheet.",
      confidence: 0.92,
      impactScore: 0.3,
    });

    expect(edges.insert).toHaveBeenCalledTimes(1);
    expect(edges.insert).toHaveBeenCalledWith({
      findingId: 502n,
      entityType: "satellite",
      entityId: 7n,
      relation: "about",
      weight: 1,
      context: { field: "operator", value: "CNES" },
    });

    expect(feedback.push).toHaveBeenCalledWith({
      category: "enrichment",
      wasAccepted: true,
      reviewerNote: "mission-fill: operator=CNES",
      operatorCountryName: "web-mission",
    });
  });
});

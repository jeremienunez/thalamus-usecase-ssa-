import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  FindingViewService,
  type EdgesReadPort,
  type FindingsPort,
} from "../../../src/services/finding-view.service";

function mockFindings(): FindingsPort {
  return {
    list: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    updateStatus: vi.fn(),
  };
}

function mockEdges(): EdgesReadPort {
  return {
    findByFindingIds: vi.fn().mockResolvedValue([]),
    findByFindingId: vi.fn().mockResolvedValue([]),
  };
}

describe("FindingViewService.list status translation", () => {
  let findings: FindingsPort;
  let edges: EdgesReadPort;
  let svc: FindingViewService;

  beforeEach(() => {
    findings = mockFindings();
    edges = mockEdges();
    svc = new FindingViewService(findings, edges);
  });

  it("translates DTO 'pending' → DB 'active'", async () => {
    await svc.list({ status: "pending" });
    expect(findings.list).toHaveBeenCalledWith({
      status: "active",
      cortex: undefined,
    });
  });

  it("translates DTO 'accepted' → DB 'archived'", async () => {
    await svc.list({ status: "accepted" });
    expect(findings.list).toHaveBeenCalledWith({
      status: "archived",
      cortex: undefined,
    });
  });

  it("translates DTO 'rejected' → DB 'invalidated'", async () => {
    await svc.list({ status: "rejected" });
    expect(findings.list).toHaveBeenCalledWith({
      status: "invalidated",
      cortex: undefined,
    });
  });

  it("translates DTO 'in-review' → DB 'active'", async () => {
    await svc.list({ status: "in-review" });
    expect(findings.list).toHaveBeenCalledWith({
      status: "active",
      cortex: undefined,
    });
  });

  it("drops unknown status values (not forwarded to repo)", async () => {
    await svc.list({ status: "bogus" });
    expect(findings.list).toHaveBeenCalledWith({
      status: undefined,
      cortex: undefined,
    });
  });

  it("passes through empty filters untouched", async () => {
    await svc.list({});
    expect(findings.list).toHaveBeenCalledWith({
      status: undefined,
      cortex: undefined,
    });
  });

  it("forwards cortex filter as-is while translating status", async () => {
    await svc.list({ status: "accepted", cortex: "thalamus" });
    expect(findings.list).toHaveBeenCalledWith({
      status: "archived",
      cortex: "thalamus",
    });
  });

  it("attaches linked entity ids for non-empty result sets", async () => {
    (findings.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "42",
        title: "Conjunction finding",
        summary: "Alert summary",
        cortex: "catalog",
        status: "active",
        confidence: 0.82,
        created_at: "2026-04-21T00:00:00.000Z",
        research_cycle_id: "7",
      },
    ]);
    (edges.findByFindingIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      { finding_id: "42", entity_type: "satellite", entity_id: "123" },
      { finding_id: "42", entity_type: "operator", entity_id: "ESA" },
      { finding_id: "42", entity_type: "orbit_regime", entity_id: "LEO" },
    ]);

    const result = await svc.list({});

    expect(edges.findByFindingIds).toHaveBeenCalledWith([42n]);
    expect(result).toEqual({
      items: [
        {
          id: "f:42",
          title: "Conjunction finding",
          summary: "Alert summary",
          cortex: "catalog",
          status: "pending",
          priority: 82,
          createdAt: "2026-04-21T00:00:00.000Z",
          linkedEntityIds: ["sat:123", "op:ESA", "regime:LEO"],
          evidence: [],
        },
      ],
      count: 1,
    });
  });

  it("loads detail view with linked entities and mapped evidence", async () => {
    (findings.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "42",
      title: "Conjunction finding",
      summary: "Alert summary",
      cortex: "catalog",
      status: "active",
      confidence: 0.82,
      created_at: "2026-04-21T00:00:00.000Z",
      research_cycle_id: "7",
      evidence: [
        {
          source: "osint",
          data: {
            url: "https://example.org/finding",
            snippet: "Grounded snippet",
          },
        },
      ],
    });
    (edges.findByFindingId as ReturnType<typeof vi.fn>).mockResolvedValue([
      { entity_type: "satellite", entity_id: "123" },
      { entity_type: "operator", entity_id: "ESA" },
      { entity_type: "orbit_regime", entity_id: "LEO" },
    ]);

    const result = await svc.findById("f:42");

    expect(findings.findById).toHaveBeenCalledWith(42n);
    expect(edges.findByFindingId).toHaveBeenCalledWith(42n, 20);
    expect(result).toEqual({
      id: "f:42",
      title: "Conjunction finding",
      summary: "Alert summary",
      cortex: "catalog",
      status: "pending",
      priority: 82,
      createdAt: "2026-04-21T00:00:00.000Z",
      linkedEntityIds: ["sat:123", "op:ESA", "regime:LEO"],
      evidence: [
        {
          kind: "osint",
          uri: "https://example.org/finding",
          snippet: "Grounded snippet",
        },
      ],
    });
  });
});

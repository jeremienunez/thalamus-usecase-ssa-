import { describe, it, expect, vi, beforeEach } from "vitest";
import { FindingViewService } from "../../../src/services/finding-view.service";
import type { FindingRepository } from "../../../src/repositories/finding.repository";
import type { ResearchEdgeRepository } from "../../../src/repositories/research-edge.repository";

function mockFindings(): FindingRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    updateStatus: vi.fn(),
    insert: vi.fn(),
  } as unknown as FindingRepository;
}

function mockEdges(): ResearchEdgeRepository {
  return {
    findByFindingIds: vi.fn().mockResolvedValue([]),
    findByFindingId: vi.fn().mockResolvedValue([]),
  } as unknown as ResearchEdgeRepository;
}

describe("FindingViewService.list status translation", () => {
  let findings: FindingRepository;
  let edges: ResearchEdgeRepository;
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
});

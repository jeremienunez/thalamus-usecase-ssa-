import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  ResearchCortex,
  ResearchCycleStatus,
  ResearchCycleTrigger,
  ResearchEntityType,
  ResearchFindingType,
  ResearchRelation,
  ResearchStatus,
} from "@interview/shared/enum";
import { registerResearchWriteRoutes } from "../../../src/routes/research-write.routes";

describe("registerResearchWriteRoutes", () => {
  it("requires the kernel shared secret before writing research cycles", async () => {
    const writer: Parameters<typeof registerResearchWriteRoutes>[1] = {
      createCycle: vi.fn(),
      incrementCycleFindings: vi.fn(),
      updateCycleFindingsCount: vi.fn(),
      createEdges: vi.fn(),
      createFinding: vi.fn(),
      upsertFindingByDedupHash: vi.fn(),
      linkFindingToCycle: vi.fn(),
      emitFindingTransactional: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerResearchWriteRoutes(app, writer, {
      simKernelSharedSecret: "kernel-secret",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/research/cycles",
      payload: {
        triggerType: ResearchCycleTrigger.System,
        status: ResearchCycleStatus.Running,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(writer.createCycle).not.toHaveBeenCalled();
    await app.close();
  });

  it("passes authenticated cycle writes to the research writer", async () => {
    const writer: Parameters<typeof registerResearchWriteRoutes>[1] = {
      createCycle: vi.fn().mockResolvedValue({ id: 101n }),
      incrementCycleFindings: vi.fn(),
      updateCycleFindingsCount: vi.fn(),
      createEdges: vi.fn(),
      createFinding: vi.fn(),
      upsertFindingByDedupHash: vi.fn(),
      linkFindingToCycle: vi.fn(),
      emitFindingTransactional: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerResearchWriteRoutes(app, writer, {
      simKernelSharedSecret: "kernel-secret",
    });
    const payload = {
      triggerType: ResearchCycleTrigger.System,
      status: ResearchCycleStatus.Running,
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/research/cycles",
      headers: { "x-sim-kernel-secret": "kernel-secret" },
      payload,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: "101" });
    expect(writer.createCycle).toHaveBeenCalledWith(payload);
    await app.close();
  });

  it("rejects invalid cycle DTOs before they reach the writer", async () => {
    const writer: Parameters<typeof registerResearchWriteRoutes>[1] = {
      createCycle: vi.fn(),
      incrementCycleFindings: vi.fn(),
      updateCycleFindingsCount: vi.fn(),
      createEdges: vi.fn(),
      createFinding: vi.fn(),
      upsertFindingByDedupHash: vi.fn(),
      linkFindingToCycle: vi.fn(),
      emitFindingTransactional: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerResearchWriteRoutes(app, writer, {
      simKernelSharedSecret: "kernel-secret",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/research/cycles",
      headers: { "x-sim-kernel-secret": "kernel-secret" },
      payload: {
        triggerType: "not-a-trigger",
        status: ResearchCycleStatus.Running,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(writer.createCycle).not.toHaveBeenCalled();
    await app.close();
  });

  it("posts a business finding-emission DTO and injects the persisted finding id into edges", async () => {
    const writer: Parameters<typeof registerResearchWriteRoutes>[1] = {
      createCycle: vi.fn(),
      incrementCycleFindings: vi.fn(),
      updateCycleFindingsCount: vi.fn(),
      createEdges: vi.fn(),
      createFinding: vi.fn(),
      upsertFindingByDedupHash: vi.fn(),
      linkFindingToCycle: vi.fn(),
      emitFindingTransactional: vi.fn().mockResolvedValue({
        finding: { id: 202n },
        inserted: true,
        linked: true,
        edges: [{ id: 303n }],
      }),
    };
    const app = Fastify({ logger: false });
    registerResearchWriteRoutes(app, writer, {
      simKernelSharedSecret: "kernel-secret",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/research/finding-emissions",
      headers: { "x-sim-kernel-secret": "kernel-secret" },
      payload: {
        finding: {
          researchCycleId: "101",
          cortex: ResearchCortex.OrbitalAnalyst,
          findingType: ResearchFindingType.Insight,
          status: ResearchStatus.Active,
          title: "Route finding",
          summary: "Route summary",
          evidence: [],
          confidence: 0.8,
        },
        link: { cycleId: "101", iteration: 2 },
        edges: [
          {
            entityType: ResearchEntityType.Satellite,
            entityId: "404",
            relation: ResearchRelation.About,
            weight: 1,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      findingId: "202",
      inserted: true,
      linked: true,
      edgeIds: ["303"],
    });
    expect(writer.emitFindingTransactional).toHaveBeenCalledWith({
      finding: expect.objectContaining({
        researchCycleId: 101n,
        title: "Route finding",
      }),
      link: { cycleId: 101n, iteration: 2 },
      edges: [
        expect.objectContaining({
          entityId: 404n,
        }),
      ],
    });
    expect(writer.upsertFindingByDedupHash).not.toHaveBeenCalled();
    expect(writer.linkFindingToCycle).not.toHaveBeenCalled();
    expect(writer.createEdges).not.toHaveBeenCalled();
    await app.close();
  });

  it("parses cycle id params for increment-findings", async () => {
    const writer: Parameters<typeof registerResearchWriteRoutes>[1] = {
      createCycle: vi.fn(),
      incrementCycleFindings: vi.fn().mockResolvedValue(undefined),
      updateCycleFindingsCount: vi.fn(),
      createEdges: vi.fn(),
      createFinding: vi.fn(),
      upsertFindingByDedupHash: vi.fn(),
      linkFindingToCycle: vi.fn(),
      emitFindingTransactional: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerResearchWriteRoutes(app, writer, {
      simKernelSharedSecret: "kernel-secret",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/research/cycles/505/increment-findings",
      headers: { "x-sim-kernel-secret": "kernel-secret" },
    });

    expect(res.statusCode).toBe(204);
    expect(writer.incrementCycleFindings).toHaveBeenCalledWith(505n);
    await app.close();
  });
});

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerStatsRoutes } from "../../../src/routes/stats.routes";
import type { StatsView } from "../../../src/types/stats.types";

describe("registerStatsRoutes", () => {
  it("wires the public /api/stats route to the stats snapshot service", async () => {
    const service: Parameters<typeof registerStatsRoutes>[1] = {
      snapshot: vi.fn().mockResolvedValue({
        satellites: 10,
        conjunctions: 3,
        kgNodes: 12,
        kgEdges: 14,
        findings: 2,
        researchCycles: 7,
        byStatus: { pending: 1, accepted: 1 },
        byCortex: { catalog: 2 },
      } satisfies StatsView),
    };
    const app = Fastify({ logger: false });
    registerStatsRoutes(app, service);

    const res = await app.inject({ method: "GET", url: "/api/stats" });

    expect(service.snapshot).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      satellites: 10,
      conjunctions: 3,
      kgNodes: 12,
      kgEdges: 14,
      findings: 2,
      researchCycles: 7,
      byStatus: { pending: 1, accepted: 1 },
      byCortex: { catalog: 2 },
    });
    await app.close();
  });

  it("does not expose the stale non-api /stats path", async () => {
    const service: Parameters<typeof registerStatsRoutes>[1] = {
      snapshot: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerStatsRoutes(app, service);

    const res = await app.inject({ method: "GET", url: "/stats" });

    expect(res.statusCode).toBe(404);
    expect(service.snapshot).not.toHaveBeenCalled();
    await app.close();
  });
});

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerKnnPropagationRoutes } from "../../../src/routes/knn-propagation.routes";
import type { PropagateStats } from "../../../src/services/knn-propagation.service";

describe("registerKnnPropagationRoutes", () => {
  it("returns 400 on invalid public body and does not call the service", async () => {
    const service: Parameters<typeof registerKnnPropagationRoutes>[1] = {
      propagate: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerKnnPropagationRoutes(app, service);

    const res = await app.inject({
      method: "POST",
      url: "/api/sweep/mission/knn-propagate",
      payload: { field: "thermal_margin" },
    });

    expect(res.statusCode).toBe(400);
    expect(service.propagate).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards the validated body on the public knn route", async () => {
    const service: Parameters<typeof registerKnnPropagationRoutes>[1] = {
      propagate: vi.fn().mockResolvedValue({
        field: "lifetime",
        k: 3,
        minSim: 0.99,
        attempted: 1,
        filled: 0,
        disagree: 0,
        tooFar: 1,
        outOfRange: 0,
        sampleFills: [],
      } satisfies PropagateStats),
    };
    const app = Fastify({ logger: false });
    registerKnnPropagationRoutes(app, service);

    const res = await app.inject({
      method: "POST",
      url: "/api/sweep/mission/knn-propagate",
      payload: { field: "lifetime", k: 1, minSim: 2, limit: 9999, dryRun: true },
    });

    expect(service.propagate).toHaveBeenCalledWith({
      field: "lifetime",
      k: 3,
      minSim: 0.99,
      limit: 2000,
      dryRun: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      field: "lifetime",
      k: 3,
      minSim: 0.99,
      attempted: 1,
      filled: 0,
      disagree: 0,
      tooFar: 1,
      outOfRange: 0,
      sampleFills: [],
    });
    await app.close();
  });

  it("does not expose the stale non-api knn route", async () => {
    const service: Parameters<typeof registerKnnPropagationRoutes>[1] = {
      propagate: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerKnnPropagationRoutes(app, service);

    const res = await app.inject({
      method: "POST",
      url: "/knn",
      payload: { field: "lifetime" },
    });

    expect(res.statusCode).toBe(404);
    expect(service.propagate).not.toHaveBeenCalled();
    await app.close();
  });
});

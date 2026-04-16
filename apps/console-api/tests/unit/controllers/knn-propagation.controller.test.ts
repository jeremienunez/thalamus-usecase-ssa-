import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { knnPropagateController } from "../../../src/controllers/knn-propagation.controller";

describe("knnPropagateController", () => {
  it("returns 400 on invalid body and does not call the service", async () => {
    const service = { propagate: vi.fn() };
    const app = Fastify({ logger: false });
    app.post("/knn", knnPropagateController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/knn",
      payload: { field: "thermal_margin" },
    });

    expect(res.statusCode).toBe(400);
    expect(service.propagate).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards the validated body to the service", async () => {
    const service = {
      propagate: vi.fn().mockResolvedValue({ attempted: 1, filled: 0 }),
    };
    const app = Fastify({ logger: false });
    app.post("/knn", knnPropagateController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/knn",
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
    expect(res.json()).toEqual({ attempted: 1, filled: 0 });
    await app.close();
  });
});

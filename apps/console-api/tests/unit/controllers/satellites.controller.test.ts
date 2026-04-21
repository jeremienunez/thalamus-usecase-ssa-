import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerSatelliteRoutes } from "../../../src/routes/satellites.routes";

describe("registerSatelliteRoutes", () => {
  it("returns 400 on invalid public query params and does not call the service", async () => {
    const service = { list: vi.fn() };
    const app = Fastify({ logger: false });
    registerSatelliteRoutes(app, service as never);

    const res = await app.inject({
      method: "GET",
      url: "/api/satellites?regime=geo",
    });

    expect(res.statusCode).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
    await app.close();
  });

  it("parses and clamps the public /api/satellites query before calling the service", async () => {
    const service = {
      list: vi.fn().mockResolvedValue({ items: [], count: 0 }),
    };
    const app = Fastify({ logger: false });
    registerSatelliteRoutes(app, service as never);

    const res = await app.inject({
      method: "GET",
      url: "/api/satellites?regime=GEO&limit=9999",
    });

    expect(service.list).toHaveBeenCalledWith({ limit: 5000, regime: "GEO" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], count: 0 });
    await app.close();
  });

  it("does not accidentally expose the stale non-api /satellites path", async () => {
    const service = {
      list: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerSatelliteRoutes(app, service as never);

    const res = await app.inject({
      method: "GET",
      url: "/satellites?regime=GEO",
    });

    expect(res.statusCode).toBe(404);
    expect(service.list).not.toHaveBeenCalled();
    await app.close();
  });
});

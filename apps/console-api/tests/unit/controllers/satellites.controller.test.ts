import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { satellitesController } from "../../../src/controllers/satellites.controller";

describe("satellitesController", () => {
  it("returns 400 on invalid query and does not call the service", async () => {
    const service = { list: vi.fn() };
    const app = Fastify({ logger: false });
    app.get("/satellites", satellitesController(service as never));

    const res = await app.inject({
      method: "GET",
      url: "/satellites?regime=geo",
    });

    expect(res.statusCode).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards parsed limit and regime to the service", async () => {
    const service = {
      list: vi.fn().mockResolvedValue({ items: [], count: 0 }),
    };
    const app = Fastify({ logger: false });
    app.get("/satellites", satellitesController(service as never));

    const res = await app.inject({
      method: "GET",
      url: "/satellites?regime=GEO&limit=9999",
    });

    expect(service.list).toHaveBeenCalledWith({ limit: 5000, regime: "GEO" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerConjunctionRoutes } from "../../../src/routes/conjunctions.routes";

describe("registerConjunctionRoutes", () => {
  it("returns 400 on invalid /api/conjunctions query and does not call the service", async () => {
    const service = { list: vi.fn(), screen: vi.fn(), knnCandidates: vi.fn() };
    const app = Fastify({ logger: false });
    registerConjunctionRoutes(app, service as never);

    const res = await app.inject({
      method: "GET",
      url: "/api/conjunctions?minPc=true",
    });

    expect(res.statusCode).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.screen).not.toHaveBeenCalled();
    expect(service.knnCandidates).not.toHaveBeenCalled();
    await app.close();
  });

  it("defaults and clamps minPc on the public conjunction list route", async () => {
    const service = {
      list: vi.fn().mockResolvedValue({ items: [], count: 0 }),
      screen: vi.fn(),
      knnCandidates: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerConjunctionRoutes(app, service as never);

    const first = await app.inject({ method: "GET", url: "/api/conjunctions" });
    const second = await app.inject({
      method: "GET",
      url: "/api/conjunctions?minPc=5",
    });

    expect(service.list).toHaveBeenNthCalledWith(1, { minPc: 0 });
    expect(service.list).toHaveBeenNthCalledWith(2, { minPc: 1 });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual({ items: [], count: 0 });
    await app.close();
  });

  it("parses and clamps the public /api/conjunctions/screen query", async () => {
    const service = {
      list: vi.fn(),
      screen: vi.fn().mockResolvedValue({ items: [], count: 0 }),
      knnCandidates: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerConjunctionRoutes(app, service as never);

    const res = await app.inject({
      method: "GET",
      url: "/api/conjunctions/screen?windowHours=99999&primaryNoradId=25544&limit=999",
    });

    expect(res.statusCode).toBe(200);
    expect(service.screen).toHaveBeenCalledWith({
      windowHours: 8760,
      primaryNoradId: "25544",
      limit: 500,
    });
    expect(service.list).not.toHaveBeenCalled();
    expect(service.knnCandidates).not.toHaveBeenCalled();
    await app.close();
  });

  it("parses knn candidate params and keeps them on the dedicated public route", async () => {
    const service = {
      list: vi.fn(),
      screen: vi.fn(),
      knnCandidates: vi.fn().mockResolvedValue({ items: [], count: 0 }),
    };
    const app = Fastify({ logger: false });
    registerConjunctionRoutes(app, service as never);

    const res = await app.inject({
      method: "GET",
      url:
        "/api/conjunctions/knn-candidates?" +
        "targetNoradId=25544&knnK=9999&limit=999&marginKm=999" +
        "&objectClass=Payload&excludeSameFamily=true&efSearch=1",
    });

    expect(res.statusCode).toBe(200);
    expect(service.knnCandidates).toHaveBeenCalledWith({
      targetNoradId: 25544,
      knnK: 1000,
      limit: 500,
      marginKm: 500,
      objectClass: "Payload",
      excludeSameFamily: true,
      efSearch: 10,
    });
    expect(service.list).not.toHaveBeenCalled();
    expect(service.screen).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not expose stale non-api conjunction routes", async () => {
    const service = { list: vi.fn(), screen: vi.fn(), knnCandidates: vi.fn() };
    const app = Fastify({ logger: false });
    registerConjunctionRoutes(app, service as never);

    const list = await app.inject({ method: "GET", url: "/conjunctions" });
    const screen = await app.inject({
      method: "GET",
      url: "/conjunctions/screen",
    });
    const knn = await app.inject({
      method: "GET",
      url: "/conjunctions/knn-candidates?targetNoradId=25544",
    });

    expect(list.statusCode).toBe(404);
    expect(screen.statusCode).toBe(404);
    expect(knn.statusCode).toBe(404);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.screen).not.toHaveBeenCalled();
    expect(service.knnCandidates).not.toHaveBeenCalled();
    await app.close();
  });
});

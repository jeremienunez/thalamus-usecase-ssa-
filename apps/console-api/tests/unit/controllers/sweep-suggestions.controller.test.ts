import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerSweepRoutes } from "../../../src/routes/sweep.routes";

function missionStub() {
  const mission: Parameters<typeof registerSweepRoutes>[2] = {
    start: vi.fn(),
    stop: vi.fn(),
    publicState: vi.fn(),
  };
  return mission;
}

describe("registerSweepRoutes suggestions endpoints", () => {
  it("returns the public suggestions list payload", async () => {
    const service: Parameters<typeof registerSweepRoutes>[1] = {
      list: vi.fn().mockResolvedValue({ items: [{ id: "s:1" }], count: 1 }),
      review: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerSweepRoutes(app, service, missionStub());

    const res = await app.inject({
      method: "GET",
      url: "/api/sweep/suggestions",
    });

    expect(service.list).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [{ id: "s:1" }], count: 1 });
    await app.close();
  });

  it("returns 400 when the matched public route carries an empty id param", async () => {
    const service: Parameters<typeof registerSweepRoutes>[1] = {
      review: vi.fn(),
      list: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerSweepRoutes(app, service, missionStub());

    const res = await app.inject({
      method: "POST",
      url: "/api/sweep/suggestions//review",
      payload: { accept: true },
    });

    expect(res.statusCode).toBe(400);
    expect(service.review).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 400 on an invalid public review body and does not call the service", async () => {
    const service: Parameters<typeof registerSweepRoutes>[1] = {
      review: vi.fn(),
      list: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerSweepRoutes(app, service, missionStub());

    const badBody = await app.inject({
      method: "POST",
      url: "/api/sweep/suggestions/s:1/review",
      payload: { accept: "yes" },
    });

    expect(badBody.statusCode).toBe(400);
    expect(service.review).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 404 when the service reports notFound on the public review route", async () => {
    const service: Parameters<typeof registerSweepRoutes>[1] = {
      review: vi.fn().mockResolvedValue({ ok: false, notFound: true }),
      list: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerSweepRoutes(app, service, missionStub());

    const res = await app.inject({
      method: "POST",
      url: "/api/sweep/suggestions/s:404/review",
      payload: { accept: true },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found" });
    await app.close();
  });

  it("returns the service review payload on the public success path", async () => {
    const service: Parameters<typeof registerSweepRoutes>[1] = {
      review: vi.fn().mockResolvedValue({
        ok: true,
        reviewed: true,
        resolution: { applied: true },
      }),
      list: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerSweepRoutes(app, service, missionStub());

    const res = await app.inject({
      method: "POST",
      url: "/api/sweep/suggestions/s:1/review",
      payload: { accept: true, reason: "looks good" },
    });

    expect(service.review).toHaveBeenCalledWith("s:1", true, "looks good");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      reviewed: true,
      resolution: { applied: true },
    });
    await app.close();
  });

  it("does not expose stale non-api suggestions paths", async () => {
    const service: Parameters<typeof registerSweepRoutes>[1] = {
      review: vi.fn(),
      list: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerSweepRoutes(app, service, missionStub());

    const list = await app.inject({ method: "GET", url: "/suggestions" });
    const review = await app.inject({
      method: "POST",
      url: "/suggestions/s:1/review",
      payload: { accept: true },
    });

    expect(list.statusCode).toBe(404);
    expect(review.statusCode).toBe(404);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.review).not.toHaveBeenCalled();
    await app.close();
  });
});

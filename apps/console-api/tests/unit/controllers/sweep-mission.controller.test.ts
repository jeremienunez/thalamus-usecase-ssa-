import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerSweepRoutes } from "../../../src/routes/sweep.routes";

function suggestionsStub() {
  return {
    list: vi.fn(),
    review: vi.fn(),
  };
}

describe("registerSweepRoutes mission endpoints", () => {
  it("returns 400 on invalid body and does not call the mission service", async () => {
    const service = { start: vi.fn() };
    const suggestions = suggestionsStub();
    const app = Fastify({ logger: false });
    registerSweepRoutes(app, suggestions as never, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/sweep/mission/start",
      payload: { maxSatsPerSuggestion: true },
    });

    expect(res.statusCode).toBe(400);
    expect(service.start).not.toHaveBeenCalled();
    expect(suggestions.list).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards the parsed public mission-start body with clamping applied", async () => {
    const mission = {
      start: vi.fn().mockResolvedValue({ ok: true, state: { total: 3 } }),
    };
    const suggestions = suggestionsStub();
    const app = Fastify({ logger: false });
    registerSweepRoutes(app, suggestions as never, mission as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/sweep/mission/start",
      payload: { maxSatsPerSuggestion: 99 },
    });

    expect(mission.start).toHaveBeenCalledWith({ maxSatsPerSuggestion: 20 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: { total: 3 } });
    await app.close();
  });

  it("wires the public stop and status routes to the mission service", async () => {
    const mission = {
      stop: vi.fn().mockReturnValue({ ok: true, state: { running: false } }),
      publicState: vi.fn().mockReturnValue({ running: true, total: 4 }),
    };
    const suggestions = suggestionsStub();
    const app = Fastify({ logger: false });
    registerSweepRoutes(app, suggestions as never, mission as never);

    const stop = await app.inject({
      method: "POST",
      url: "/api/sweep/mission/stop",
    });
    const status = await app.inject({
      method: "GET",
      url: "/api/sweep/mission/status",
    });

    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toEqual({ ok: true, state: { running: false } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ running: true, total: 4 });
    expect(mission.stop).toHaveBeenCalledOnce();
    expect(mission.publicState).toHaveBeenCalledOnce();
    expect(suggestions.list).not.toHaveBeenCalled();
    expect(suggestions.review).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not expose the stale non-api mission paths", async () => {
    const mission = {
      start: vi.fn(),
      stop: vi.fn(),
      publicState: vi.fn(),
    };
    const suggestions = suggestionsStub();
    const app = Fastify({ logger: false });
    registerSweepRoutes(app, suggestions as never, mission as never);

    const start = await app.inject({ method: "POST", url: "/mission/start" });
    const stop = await app.inject({ method: "POST", url: "/mission/stop" });
    const status = await app.inject({ method: "GET", url: "/mission/status" });

    expect(start.statusCode).toBe(404);
    expect(stop.statusCode).toBe(404);
    expect(status.statusCode).toBe(404);
    expect(mission.start).not.toHaveBeenCalled();
    expect(mission.stop).not.toHaveBeenCalled();
    expect(mission.publicState).not.toHaveBeenCalled();
    await app.close();
  });
});

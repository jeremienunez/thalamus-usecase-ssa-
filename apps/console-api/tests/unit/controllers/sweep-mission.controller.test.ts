import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  missionStartController,
  missionStatusController,
  missionStopController,
} from "../../../src/controllers/sweep-mission.controller";

describe("missionStartController", () => {
  it("returns 400 on invalid body and does not call the service", async () => {
    const service = { start: vi.fn() };
    const app = Fastify({ logger: false });
    app.post("/mission/start", missionStartController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/mission/start",
      payload: { maxSatsPerSuggestion: true },
    });

    expect(res.statusCode).toBe(400);
    expect(service.start).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards the parsed body to the service", async () => {
    const service = {
      start: vi.fn().mockResolvedValue({ ok: true, state: { total: 3 } }),
    };
    const app = Fastify({ logger: false });
    app.post("/mission/start", missionStartController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/mission/start",
      payload: { maxSatsPerSuggestion: 99 },
    });

    expect(service.start).toHaveBeenCalledWith({ maxSatsPerSuggestion: 20 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: { total: 3 } });
    await app.close();
  });
});

describe("missionStopController and missionStatusController", () => {
  it("returns the service payloads for stop and status", async () => {
    const service = {
      stop: vi.fn().mockReturnValue({ ok: true, state: { running: false } }),
      publicState: vi.fn().mockReturnValue({ running: true, total: 4 }),
    };
    const app = Fastify({ logger: false });
    app.post("/mission/stop", missionStopController(service as never));
    app.get("/mission/status", missionStatusController(service as never));

    const stop = await app.inject({ method: "POST", url: "/mission/stop" });
    const status = await app.inject({ method: "GET", url: "/mission/status" });

    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toEqual({ ok: true, state: { running: false } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ running: true, total: 4 });
    await app.close();
  });
});

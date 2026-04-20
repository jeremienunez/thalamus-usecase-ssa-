import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  autonomyResetController,
  autonomyStartController,
  autonomyStatusController,
  autonomyStopController,
} from "../../../src/controllers/autonomy.controller";

describe("autonomyStartController", () => {
  it("returns 400 on invalid body and does not call the service", async () => {
    const service = { start: vi.fn() };
    const app = Fastify({ logger: false });
    app.post("/autonomy/start", autonomyStartController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/autonomy/start",
      payload: { intervalSec: true },
    });

    expect(res.statusCode).toBe(400);
    expect(service.start).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards the clamped intervalSec to the service", async () => {
    const service = {
      start: vi.fn().mockReturnValue({ ok: true, state: { running: true } }),
    };
    const app = Fastify({ logger: false });
    app.post("/autonomy/start", autonomyStartController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/autonomy/start",
      payload: { intervalSec: 900 },
    });

    expect(service.start).toHaveBeenCalledWith(600);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: { running: true } });
    await app.close();
  });
});

describe("autonomyStopController and autonomyStatusController", () => {
  it("returns the service payloads for stop and status", async () => {
    const service = {
      stop: vi.fn().mockReturnValue({ ok: true, state: { running: false } }),
      resetSpend: vi.fn().mockReturnValue({ ok: true, state: { running: false } }),
      publicState: vi.fn().mockReturnValue({ running: true, intervalMs: 45_000 }),
    };
    const app = Fastify({ logger: false });
    app.post("/autonomy/stop", autonomyStopController(service as never));
    app.post("/autonomy/reset", autonomyResetController(service as never));
    app.get("/autonomy/status", autonomyStatusController(service as never));

    const stop = await app.inject({ method: "POST", url: "/autonomy/stop" });
    const reset = await app.inject({ method: "POST", url: "/autonomy/reset" });
    const status = await app.inject({ method: "GET", url: "/autonomy/status" });

    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toEqual({ ok: true, state: { running: false } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ ok: true, state: { running: false } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ running: true, intervalMs: 45_000 });
    await app.close();
  });
});

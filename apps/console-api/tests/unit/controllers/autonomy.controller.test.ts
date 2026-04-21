import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { AutonomyTick } from "../../../src/types/autonomy.types";
import type { AutonomyService } from "../../../src/services/autonomy.service";
import { registerAutonomyRoutes } from "../../../src/routes/autonomy.routes";

const tick = {
  id: "a:1",
  action: "thalamus",
  queryOrMode: "query",
  startedAt: "2026-04-21T00:00:00.000Z",
  completedAt: "2026-04-21T00:00:01.000Z",
  emitted: 2,
  costUsd: 0.03,
} satisfies AutonomyTick;

const fullState: ReturnType<AutonomyService["publicState"]> = {
  running: true,
  intervalMs: 45_000,
  startedAt: "2026-04-21T00:00:00.000Z",
  tickCount: 3,
  currentTick: tick,
  history: [tick],
  dailySpendUsd: 0.03,
  monthlySpendUsd: 0.03,
  thalamusCyclesToday: 1,
  stoppedReason: null,
  nextTickInMs: 12_000,
};

describe("registerAutonomyRoutes", () => {
  it("returns 400 on invalid public body and does not call the service", async () => {
    const service = { start: vi.fn() };
    const app = Fastify({ logger: false });
    registerAutonomyRoutes(app, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/autonomy/start",
      payload: { intervalSec: true },
    });

    expect(res.statusCode).toBe(400);
    expect(service.start).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards the clamped intervalSec on the public start route", async () => {
    const service = {
      start: vi.fn().mockReturnValue({ ok: true, state: fullState }),
    };
    const app = Fastify({ logger: false });
    registerAutonomyRoutes(app, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/autonomy/start",
      payload: { intervalSec: 900 },
    });

    expect(service.start).toHaveBeenCalledWith(600);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: fullState });
    await app.close();
  });

  it("wires the public stop, reset and status routes to the autonomy service", async () => {
    const service = {
      stop: vi.fn().mockReturnValue({
        ok: true,
        state: {
          ...fullState,
          running: false,
          currentTick: null,
          stoppedReason: "stopped_by_operator",
        },
      }),
      resetSpend: vi.fn().mockReturnValue({
        ok: true,
        state: { ...fullState, dailySpendUsd: 0, monthlySpendUsd: 0 },
      }),
      publicState: vi.fn().mockReturnValue(fullState),
    };
    const app = Fastify({ logger: false });
    registerAutonomyRoutes(app, service as never);

    const stop = await app.inject({ method: "POST", url: "/api/autonomy/stop" });
    const reset = await app.inject({
      method: "POST",
      url: "/api/autonomy/reset",
    });
    const status = await app.inject({
      method: "GET",
      url: "/api/autonomy/status",
    });

    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toEqual({
      ok: true,
      state: {
        ...fullState,
        running: false,
        currentTick: null,
        stoppedReason: "stopped_by_operator",
      },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({
      ok: true,
      state: { ...fullState, dailySpendUsd: 0, monthlySpendUsd: 0 },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual(fullState);
    expect(service.stop).toHaveBeenCalledOnce();
    expect(service.resetSpend).toHaveBeenCalledOnce();
    expect(service.publicState).toHaveBeenCalledOnce();
    await app.close();
  });

  it("does not expose stale non-api autonomy paths", async () => {
    const service = {
      start: vi.fn(),
      stop: vi.fn(),
      resetSpend: vi.fn(),
      publicState: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerAutonomyRoutes(app, service as never);

    const start = await app.inject({ method: "POST", url: "/autonomy/start" });
    const stop = await app.inject({ method: "POST", url: "/autonomy/stop" });
    const reset = await app.inject({ method: "POST", url: "/autonomy/reset" });
    const status = await app.inject({ method: "GET", url: "/autonomy/status" });

    expect(start.statusCode).toBe(404);
    expect(stop.statusCode).toBe(404);
    expect(reset.statusCode).toBe(404);
    expect(status.statusCode).toBe(404);
    expect(service.start).not.toHaveBeenCalled();
    expect(service.stop).not.toHaveBeenCalled();
    expect(service.resetSpend).not.toHaveBeenCalled();
    expect(service.publicState).not.toHaveBeenCalled();
    await app.close();
  });
});

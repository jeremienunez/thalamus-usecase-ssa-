import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHealthRoutes } from "../../../src/routes/health.routes";

describe("registerHealthRoutes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes /health with an ISO timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:34:56.000Z"));
    const app = Fastify({ logger: false });
    registerHealthRoutes(app);

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      ts: "2026-04-16T12:34:56.000Z",
    });
    await app.close();
    vi.useRealTimers();
  });

  it("does not mount health under a stale /api prefix", async () => {
    const app = Fastify({ logger: false });
    registerHealthRoutes(app);

    const res = await app.inject({ method: "GET", url: "/api/health" });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

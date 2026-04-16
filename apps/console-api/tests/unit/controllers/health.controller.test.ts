import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { healthController } from "../../../src/controllers/health.controller";

describe("healthController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok with an ISO timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:34:56.000Z"));
    const app = Fastify({ logger: false });
    app.get("/health", healthController);

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      ts: "2026-04-16T12:34:56.000Z",
    });
    await app.close();
    vi.useRealTimers();
  });
});

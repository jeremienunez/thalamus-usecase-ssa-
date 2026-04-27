import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerTemporalRoutes } from "../../../src/routes/temporal.routes";

describe("registerTemporalRoutes", () => {
  it("parses temporal pattern query parameters for the read-only cortex route", async () => {
    const service: Parameters<typeof registerTemporalRoutes>[1] = {
      queryPatterns: vi.fn().mockResolvedValue({ patterns: [], nextCursor: null }),
    };
    const app = Fastify({ logger: false });
    registerTemporalRoutes(app, service);

    const res = await app.inject({
      method: "GET",
      url: "/api/cortex/temporal-patterns?terminalStatus=timeout&sourceDomain=production&includeAuditOnly=true&limit=999",
    });

    expect(res.statusCode).toBe(200);
    expect(service.queryPatterns).toHaveBeenCalledWith({
      terminalStatus: "timeout",
      sourceDomain: "production",
      includeAuditOnly: true,
      limit: 50,
    });
    expect(res.json()).toEqual({ patterns: [], nextCursor: null });
    await app.close();
  });

  it("returns 400 for malformed audit-mode query flags", async () => {
    const service: Parameters<typeof registerTemporalRoutes>[1] = {
      queryPatterns: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerTemporalRoutes(app, service);

    const res = await app.inject({
      method: "GET",
      url: "/api/cortex/temporal-patterns?includeAuditOnly=maybe",
    });

    expect(res.statusCode).toBe(400);
    expect(service.queryPatterns).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not expose mutable temporal pattern endpoints", async () => {
    const service: Parameters<typeof registerTemporalRoutes>[1] = {
      queryPatterns: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerTemporalRoutes(app, service);

    const res = await app.inject({
      method: "POST",
      url: "/api/cortex/temporal-patterns",
      payload: { status: "accepted" },
    });

    expect(res.statusCode).toBe(404);
    expect(service.queryPatterns).not.toHaveBeenCalled();
    await app.close();
  });
});

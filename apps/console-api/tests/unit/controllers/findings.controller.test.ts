import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { FindingView } from "@interview/shared";
import { registerFindingsRoutes } from "../../../src/routes/findings.routes";
import { HttpError } from "../../../src/utils/http-error";

const findingView: FindingView = {
  id: "f:42",
  title: "Conjunction finding",
  summary: "Alert summary",
  cortex: "catalog",
  status: "accepted",
  priority: 82,
  createdAt: "2026-04-21T00:00:00.000Z",
  linkedEntityIds: ["sat:123"],
  evidence: [],
};

describe("registerFindingsRoutes", () => {
  it("parses filters on the public findings list route", async () => {
    const service = {
      list: vi.fn().mockResolvedValue({ items: [], count: 0 }),
      findById: vi.fn(),
      updateDecision: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerFindingsRoutes(app, service as never);

    const res = await app.inject({
      method: "GET",
      url: "/api/findings?status=pending&cortex=catalog",
    });

    expect(service.list).toHaveBeenCalledWith({
      status: "pending",
      cortex: "catalog",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], count: 0 });
    expect(service.findById).not.toHaveBeenCalled();
    expect(service.updateDecision).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 400 when the public path id is malformed", async () => {
    const service = {
      list: vi.fn(),
      findById: vi.fn(),
      updateDecision: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerFindingsRoutes(app, service as never);

    const res = await app.inject({
      method: "GET",
      url: "/api/findings/abc",
    });

    expect(res.statusCode).toBe(400);
    expect(service.findById).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps HttpError.notFound from the service to 404 on the public by-id route", async () => {
    const service = {
      list: vi.fn(),
      findById: vi
        .fn()
        .mockRejectedValue(HttpError.notFound("finding not found")),
      updateDecision: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerFindingsRoutes(app, service as never);

    const res = await app.inject({
      method: "GET",
      url: "/api/findings/f:42",
    });

    expect(service.findById).toHaveBeenCalledWith("f:42");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "finding not found" });
    await app.close();
  });

  it("wraps the updated finding inside {ok:true,finding} on the public decision route", async () => {
    const service = {
      list: vi.fn(),
      findById: vi.fn(),
      updateDecision: vi.fn().mockResolvedValue(findingView),
    };
    const app = Fastify({ logger: false });
    registerFindingsRoutes(app, service as never);

    const res = await app.inject({
      method: "POST",
      url: "/api/findings/f:42/decision",
      payload: { decision: "accepted" },
    });

    expect(service.updateDecision).toHaveBeenCalledWith("f:42", "accepted");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      finding: findingView,
    });
    await app.close();
  });

  it("does not expose stale non-api findings paths", async () => {
    const service = {
      list: vi.fn(),
      findById: vi.fn(),
      updateDecision: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerFindingsRoutes(app, service as never);

    const list = await app.inject({ method: "GET", url: "/findings" });
    const byId = await app.inject({ method: "GET", url: "/findings/f:42" });
    const decision = await app.inject({
      method: "POST",
      url: "/findings/f:42/decision",
      payload: { decision: "accepted" },
    });

    expect(list.statusCode).toBe(404);
    expect(byId.statusCode).toBe(404);
    expect(decision.statusCode).toBe(404);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.findById).not.toHaveBeenCalled();
    expect(service.updateDecision).not.toHaveBeenCalled();
    await app.close();
  });
});

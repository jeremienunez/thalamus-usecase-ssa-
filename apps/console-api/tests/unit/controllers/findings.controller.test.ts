import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  findingByIdController,
  findingDecisionController,
  findingsListController,
} from "../../../src/controllers/findings.controller";
import { HttpError } from "../../../src/utils/http-error";

describe("findingsListController", () => {
  it("parses filters and forwards them to the service", async () => {
    const service = {
      list: vi.fn().mockResolvedValue({ items: [], count: 0 }),
    };
    const app = Fastify({ logger: false });
    app.get("/findings", findingsListController(service as never));

    const res = await app.inject({
      method: "GET",
      url: "/findings?status=pending&cortex=catalog",
    });

    expect(service.list).toHaveBeenCalledWith({
      status: "pending",
      cortex: "catalog",
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("findingByIdController", () => {
  it("returns 400 when the path id is malformed", async () => {
    const service = { findById: vi.fn() };
    const app = Fastify({ logger: false });
    app.get("/findings/:id", findingByIdController(service as never));

    const res = await app.inject({
      method: "GET",
      url: "/findings/abc",
    });

    expect(res.statusCode).toBe(400);
    expect(service.findById).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps HttpError.notFound from the service to 404", async () => {
    const service = {
      findById: vi.fn().mockRejectedValue(HttpError.notFound("finding not found")),
    };
    const app = Fastify({ logger: false });
    app.get("/findings/:id", findingByIdController(service as never));

    const res = await app.inject({
      method: "GET",
      url: "/findings/f:42",
    });

    expect(service.findById).toHaveBeenCalledWith("f:42");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "finding not found" });
    await app.close();
  });
});

describe("findingDecisionController", () => {
  it("returns 400 when the decision body is invalid", async () => {
    const service = { updateDecision: vi.fn() };
    const app = Fastify({ logger: false });
    app.post("/findings/:id/decision", findingDecisionController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/findings/f:42/decision",
      payload: { decision: "approve" },
    });

    expect(res.statusCode).toBe(400);
    expect(service.updateDecision).not.toHaveBeenCalled();
    await app.close();
  });

  it("wraps the updated finding inside {ok:true,finding}", async () => {
    const service = {
      updateDecision: vi.fn().mockResolvedValue({ id: "f:42", status: "accepted" }),
    };
    const app = Fastify({ logger: false });
    app.post("/findings/:id/decision", findingDecisionController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/findings/f:42/decision",
      payload: { decision: "accepted" },
    });

    expect(service.updateDecision).toHaveBeenCalledWith("f:42", "accepted");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      finding: { id: "f:42", status: "accepted" },
    });
    await app.close();
  });
});

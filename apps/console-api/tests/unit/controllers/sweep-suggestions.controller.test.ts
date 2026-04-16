import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  sweepReviewController,
  sweepSuggestionsListController,
} from "../../../src/controllers/sweep-suggestions.controller";

describe("sweepSuggestionsListController", () => {
  it("returns the service list payload", async () => {
    const service = {
      list: vi.fn().mockResolvedValue({ items: [{ id: "s:1" }], count: 1 }),
    };
    const app = Fastify({ logger: false });
    app.get("/suggestions", sweepSuggestionsListController(service as never));

    const res = await app.inject({ method: "GET", url: "/suggestions" });

    expect(service.list).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [{ id: "s:1" }], count: 1 });
    await app.close();
  });
});

describe("sweepReviewController", () => {
  it("returns 400 on invalid params/body and does not call the service", async () => {
    const service = { review: vi.fn() };
    const app = Fastify({ logger: false });
    app.post("/suggestions/:id/review", sweepReviewController(service as never));

    const badParams = await app.inject({
      method: "POST",
      url: "/suggestions//review",
      payload: { accept: true },
    });
    const badBody = await app.inject({
      method: "POST",
      url: "/suggestions/s:1/review",
      payload: { accept: "yes" },
    });

    expect(badParams.statusCode).toBe(400);
    expect(badBody.statusCode).toBe(400);
    expect(service.review).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 404 when the service reports notFound", async () => {
    const service = {
      review: vi.fn().mockResolvedValue({ ok: false, notFound: true }),
    };
    const app = Fastify({ logger: false });
    app.post("/suggestions/:id/review", sweepReviewController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/suggestions/s:404/review",
      payload: { accept: true },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found" });
    await app.close();
  });

  it("returns the service review payload on success", async () => {
    const service = {
      review: vi.fn().mockResolvedValue({
        ok: true,
        reviewed: true,
        resolution: { applied: true },
      }),
    };
    const app = Fastify({ logger: false });
    app.post("/suggestions/:id/review", sweepReviewController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/suggestions/s:1/review",
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
});

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { reflexionController } from "../../../src/controllers/reflexion.controller";
import { HttpError } from "../../../src/utils/http-error";

describe("reflexionController", () => {
  it("returns 400 on invalid body before calling the service", async () => {
    const service = { runPass: vi.fn() };
    const app = Fastify({ logger: false });
    app.post("/reflexion", reflexionController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/reflexion",
      payload: { noradId: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(service.runPass).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps HttpError.notFound from the service to a 404 response", async () => {
    const service = {
      runPass: vi.fn().mockRejectedValue(HttpError.notFound("satellite not found")),
    };
    const app = Fastify({ logger: false });
    app.post("/reflexion", reflexionController(service as never));

    const res = await app.inject({
      method: "POST",
      url: "/reflexion",
      payload: { noradId: 32958, dIncMax: 0.3, dRaanMax: 5, dMmMax: 0.05 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "satellite not found" });
    await app.close();
  });
});

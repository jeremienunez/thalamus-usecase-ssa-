import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { conjunctionsController } from "../../../src/controllers/conjunctions.controller";

describe("conjunctionsController", () => {
  it("returns 400 on invalid query and does not call the service", async () => {
    const service = { list: vi.fn() };
    const app = Fastify({ logger: false });
    app.get("/conjunctions", conjunctionsController(service as never));

    const res = await app.inject({
      method: "GET",
      url: "/conjunctions?minPc=true",
    });

    expect(res.statusCode).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
    await app.close();
  });

  it("defaults and clamps minPc before forwarding to the service", async () => {
    const service = {
      list: vi.fn().mockResolvedValue({ items: [], count: 0 }),
    };
    const app = Fastify({ logger: false });
    app.get("/conjunctions", conjunctionsController(service as never));

    const first = await app.inject({ method: "GET", url: "/conjunctions" });
    const second = await app.inject({ method: "GET", url: "/conjunctions?minPc=5" });

    expect(service.list).toHaveBeenNthCalledWith(1, { minPc: 0 });
    expect(service.list).toHaveBeenNthCalledWith(2, { minPc: 1 });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    await app.close();
  });
});

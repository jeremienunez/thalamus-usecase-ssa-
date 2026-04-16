import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { statsController } from "../../../src/controllers/stats.controller";

describe("statsController", () => {
  it("returns the service snapshot payload", async () => {
    const service = {
      snapshot: vi.fn().mockResolvedValue({ satellites: 10, findings: 2 }),
    };
    const app = Fastify({ logger: false });
    app.get("/stats", statsController(service as never));

    const res = await app.inject({ method: "GET", url: "/stats" });

    expect(service.snapshot).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ satellites: 10, findings: 2 });
    await app.close();
  });
});

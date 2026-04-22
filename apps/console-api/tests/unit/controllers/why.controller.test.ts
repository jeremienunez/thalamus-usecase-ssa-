import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerWhyRoutes } from "../../../src/routes/why.routes";

describe("registerWhyRoutes", () => {
  it("wires /api/why/:findingId to the why tree service", async () => {
    const service: Parameters<typeof registerWhyRoutes>[1] = {
      buildWhyTree: vi.fn().mockResolvedValue({
        id: "finding:4",
        label: "Finding 4",
        kind: "finding",
        children: [],
      }),
    };
    const app = Fastify({ logger: false });
    registerWhyRoutes(app, service);

    const response = await app.inject({
      method: "GET",
      url: "/api/why/f:4",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: "finding:4",
      label: "Finding 4",
      kind: "finding",
      children: [],
    });
    expect(service.buildWhyTree).toHaveBeenCalledWith("f:4");
    await app.close();
  });
});

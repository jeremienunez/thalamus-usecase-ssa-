import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerKgRoutes } from "../../../src/routes/kg.routes";

describe("registerKgRoutes", () => {
  it("wires /api/kg/nodes and /api/kg/edges to the matching service methods", async () => {
    const service: Parameters<typeof registerKgRoutes>[1] = {
      listNodes: vi.fn().mockResolvedValue({
        items: [{ id: "sat:42", label: "SAT-42", class: "Satellite" }],
      }),
      listEdges: vi.fn().mockResolvedValue({
        items: [
          {
            source: "sat:42",
            target: "payload:7",
            relation: "carries",
            confidence: 0.98,
            sourceClass: "field",
          },
        ],
      }),
    };
    const app = Fastify({ logger: false });
    registerKgRoutes(app, service);

    const nodes = await app.inject({ method: "GET", url: "/api/kg/nodes" });
    const edges = await app.inject({ method: "GET", url: "/api/kg/edges" });

    expect(nodes.statusCode).toBe(200);
    expect(nodes.json()).toEqual({
      items: [{ id: "sat:42", label: "SAT-42", class: "Satellite" }],
    });
    expect(edges.statusCode).toBe(200);
    expect(edges.json()).toEqual({
      items: [
        {
          source: "sat:42",
          target: "payload:7",
          relation: "carries",
          confidence: 0.98,
          sourceClass: "field",
        },
      ],
    });
    expect(service.listNodes).toHaveBeenCalledTimes(1);
    expect(service.listEdges).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerKgRoutes } from "../../../src/routes/kg.routes";

describe("registerKgRoutes", () => {
  it("wires kg routes to the matching service methods", async () => {
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
      getNeighbourhood: vi.fn().mockResolvedValue({
        root: "finding:4",
        nodes: [{ id: "finding:4", label: "Finding 4", class: "Finding" }],
        edges: [],
      }),
    };
    const app = Fastify({ logger: false });
    registerKgRoutes(app, service);

    const nodes = await app.inject({ method: "GET", url: "/api/kg/nodes" });
    const edges = await app.inject({ method: "GET", url: "/api/kg/edges" });
    const graph = await app.inject({
      method: "GET",
      url: "/api/kg/graph/finding:4?depth=3",
    });

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
    expect(graph.statusCode).toBe(200);
    expect(graph.json()).toEqual({
      root: "finding:4",
      nodes: [{ id: "finding:4", label: "Finding 4", class: "Finding" }],
      edges: [],
    });
    expect(service.listNodes).toHaveBeenCalledTimes(1);
    expect(service.listEdges).toHaveBeenCalledTimes(1);
    expect(service.getNeighbourhood).toHaveBeenCalledWith("finding:4", 3);
    await app.close();
  });
});

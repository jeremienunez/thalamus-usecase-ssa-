import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  kgEdgesController,
  kgNodesController,
} from "../../../src/controllers/kg.controller";

describe("kgNodesController and kgEdgesController", () => {
  it("returns the node and edge payloads from the service", async () => {
    const service = {
      listNodes: vi.fn().mockResolvedValue({ items: [{ id: "sat:42" }] }),
      listEdges: vi.fn().mockResolvedValue({ items: [{ id: "e1" }] }),
    };
    const app = Fastify({ logger: false });
    app.get("/kg/nodes", kgNodesController(service as never));
    app.get("/kg/edges", kgEdgesController(service as never));

    const nodes = await app.inject({ method: "GET", url: "/kg/nodes" });
    const edges = await app.inject({ method: "GET", url: "/kg/edges" });

    expect(nodes.statusCode).toBe(200);
    expect(nodes.json()).toEqual({ items: [{ id: "sat:42" }] });
    expect(edges.statusCode).toBe(200);
    expect(edges.json()).toEqual({ items: [{ id: "e1" }] });
    await app.close();
  });
});

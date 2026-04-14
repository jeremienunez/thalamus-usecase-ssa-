/**
 * Thalamus Routes — Research cycle + findings API
 */

import type { FastifyInstance } from "fastify";
import type { ThalamusController } from "../controllers/thalamus.controller";

export function thalamusRoutes(controller: ThalamusController) {
  return async function (fastify: FastifyInstance) {
    // Trigger research cycle
    fastify.post("/research", {
      schema: {
        body: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 3 },
            cortices: { type: "array", items: { type: "string" } },
            depth: { type: "string", enum: ["quick", "standard", "deep"] },
          },
        },
      },
      handler: controller.triggerResearch.bind(controller),
    });

    // List findings
    fastify.get("/findings", {
      schema: {
        querystring: {
          type: "object",
          properties: {
            cortex: { type: "string" },
            findingType: { type: "string" },
            minConfidence: { type: "string" },
            query: { type: "string" },
            limit: { type: "string" },
            offset: { type: "string" },
          },
        },
      },
      handler: controller.getFindings.bind(controller),
    });

    // Knowledge graph (nodes + links for visualization)
    fastify.get("/knowledge-graph", {
      schema: {
        querystring: {
          type: "object",
          properties: {
            cortex: { type: "string" },
            findingType: { type: "string" },
            minConfidence: { type: "string" },
            limit: { type: "string" },
          },
        },
      },
      handler: controller.getKnowledgeGraph.bind(controller),
    });

    // Get single finding with edges
    fastify.get("/findings/:id", {
      handler: controller.getFinding.bind(controller),
    });

    // Get all findings for an entity
    fastify.get("/graph/:type/:id", {
      handler: controller.getEntityGraph.bind(controller),
    });

    // List research cycles
    fastify.get("/cycles", {
      handler: controller.getCycles.bind(controller),
    });

    // Archive a finding
    fastify.delete("/findings/:id", {
      handler: controller.archiveFinding.bind(controller),
    });
  };
}

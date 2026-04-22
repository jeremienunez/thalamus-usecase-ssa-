import type { FastifyInstance } from "fastify";
import {
  type KgControllerPort,
  kgNodesController,
  kgEdgesController,
  kgGraphController,
} from "../controllers/kg.controller";

export function registerKgRoutes(
  app: FastifyInstance,
  service: KgControllerPort,
): void {
  app.get("/api/kg/nodes", kgNodesController(service));
  app.get("/api/kg/edges", kgEdgesController(service));
  app.get("/api/kg/graph/:id", kgGraphController(service));
}

import type { FastifyInstance } from "fastify";
import type { KgViewService } from "../services/kg-view.service";
import {
  kgNodesController,
  kgEdgesController,
} from "../controllers/kg.controller";

export function registerKgRoutes(
  app: FastifyInstance,
  service: KgViewService,
): void {
  app.get("/api/kg/nodes", kgNodesController(service));
  app.get("/api/kg/edges", kgEdgesController(service));
}

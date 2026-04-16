import type { FastifyInstance } from "fastify";
import type { OpacityService } from "../services/opacity.service";
import { opacityCandidatesController } from "../controllers/opacity.controller";

export function registerOpacityRoutes(
  app: FastifyInstance,
  service: OpacityService,
): void {
  app.get("/api/opacity/candidates", opacityCandidatesController(service));
}

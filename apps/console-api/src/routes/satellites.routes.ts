import type { FastifyInstance } from "fastify";
import type { SatelliteViewService } from "../services/satellite-view.service";
import { satellitesController } from "../controllers/satellites.controller";

export function registerSatelliteRoutes(
  app: FastifyInstance,
  service: SatelliteViewService,
): void {
  app.get<{ Querystring: { regime?: string; limit?: string } }>(
    "/api/satellites",
    satellitesController(service),
  );
}

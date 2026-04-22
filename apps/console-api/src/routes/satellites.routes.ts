import type { FastifyInstance } from "fastify";
import {
  type SatellitesControllerPort,
  satellitesController,
} from "../controllers/satellites.controller";

export function registerSatelliteRoutes(
  app: FastifyInstance,
  service: SatellitesControllerPort,
): void {
  app.get<{ Querystring: { regime?: string; limit?: string } }>(
    "/api/satellites",
    satellitesController(service),
  );
}

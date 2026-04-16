import type { FastifyInstance } from "fastify";
import type { SourceDataService } from "../services/source-data.service";
import {
  advisoryController,
  rssController,
  maneuverController,
  observationsController,
  correlationController,
  primerController,
} from "../controllers/sources.controller";

export function registerSourceRoutes(
  app: FastifyInstance,
  service: SourceDataService,
): void {
  app.get("/api/sources/advisory", advisoryController(service));
  app.get("/api/sources/rss", rssController(service));
  app.get("/api/sources/maneuver", maneuverController(service));
  app.get("/api/sources/observations", observationsController(service));
  app.get("/api/sources/correlation", correlationController(service));
  app.get("/api/sources/primer", primerController(service));
}

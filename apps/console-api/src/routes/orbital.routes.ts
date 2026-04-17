import type { FastifyInstance } from "fastify";
import type { OrbitalAnalysisService } from "../services/orbital-analysis.service";
import {
  fleetController,
  regimeController,
  slotsController,
  trafficController,
  debrisForecastController,
  launchManifestController,
} from "../controllers/orbital.controller";

export function registerOrbitalRoutes(
  app: FastifyInstance,
  service: OrbitalAnalysisService,
): void {
  app.get("/api/orbital/fleet", fleetController(service));
  app.get("/api/orbital/regime/:id", regimeController(service));
  app.get("/api/orbital/slots", slotsController(service));
  app.get("/api/orbital/traffic", trafficController(service));
  app.get("/api/orbital/debris-forecast", debrisForecastController(service));
  app.get("/api/orbital/launch-manifest", launchManifestController(service));
}

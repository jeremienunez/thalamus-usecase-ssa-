import type { FastifyInstance } from "fastify";
import type { SatelliteEnrichmentService } from "../services/satellite-enrichment.service";
import {
  satelliteFullController,
  satellitesByOperatorController,
  catalogContextController,
  replacementCostController,
  launchCostController,
} from "../controllers/satellite-enrichment.controller";

export function registerSatelliteEnrichmentRoutes(
  app: FastifyInstance,
  service: SatelliteEnrichmentService,
): void {
  app.get<{ Params: { id: string } }>(
    "/api/satellites/:id/full",
    satelliteFullController(service),
  );
  app.get<{ Params: { name: string } }>(
    "/api/satellites/by-operator/:name",
    satellitesByOperatorController(service),
  );
  app.get<{
    Querystring: {
      source?: string;
      sinceEpoch?: string;
      limit?: string;
    };
  }>("/api/satellites/catalog-context", catalogContextController(service));
  app.get<{ Querystring: { satelliteId: string } }>(
    "/api/satellites/replacement-cost",
    replacementCostController(service),
  );
  app.get<{
    Querystring: {
      orbitRegime?: string;
      minLaunchCost?: string;
      maxLaunchCost?: string;
      limit?: string;
    };
  }>("/api/satellites/launch-cost", launchCostController(service));
}

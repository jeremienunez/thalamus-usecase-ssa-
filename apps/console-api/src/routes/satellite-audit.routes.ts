import type { FastifyInstance } from "fastify";
import type { SatelliteAuditService } from "../services/satellite-audit.service";
import {
  auditDataController,
  auditClassificationController,
  auditApogeeController,
} from "../controllers/satellite-audit.controller";

export function registerSatelliteAuditRoutes(
  app: FastifyInstance,
  service: SatelliteAuditService,
): void {
  app.get<{ Querystring: { orbitRegime?: string; limit?: string } }>(
    "/api/satellites/audit/data",
    auditDataController(service),
  );
  app.get<{ Querystring: { limit?: string } }>(
    "/api/satellites/audit/classification",
    auditClassificationController(service),
  );
  app.get<{
    Querystring: { noradId?: string; windowDays?: string; limit?: string };
  }>("/api/satellites/audit/apogee", auditApogeeController(service));
}

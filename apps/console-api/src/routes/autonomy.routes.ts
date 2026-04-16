// apps/console-api/src/routes/autonomy.routes.ts
import type { FastifyInstance } from "fastify";
import type { AutonomyService } from "../services/autonomy.service";
import {
  autonomyStartController,
  autonomyStopController,
  autonomyStatusController,
} from "../controllers/autonomy.controller";

export function registerAutonomyRoutes(
  app: FastifyInstance,
  service: AutonomyService,
): void {
  app.post<{ Body: { intervalSec?: number } }>(
    "/api/autonomy/start",
    autonomyStartController(service),
  );
  app.post("/api/autonomy/stop", autonomyStopController(service));
  app.get("/api/autonomy/status", autonomyStatusController(service));
}

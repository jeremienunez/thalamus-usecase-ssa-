import type { FastifyInstance } from "fastify";
import {
  simStartPcController,
  simStartStandaloneController,
  simStartTelemetryController,
} from "../controllers/sim-launcher.controller";
import type { SimRouteServices } from "./sim-route-services";

export function registerSimLauncherRoutes(
  app: FastifyInstance,
  s: SimRouteServices,
): void {
  app.post("/api/sim/telemetry/start", simStartTelemetryController(s.launcher));
  app.post("/api/sim/pc/start", simStartPcController(s.launcher));
  app.post("/api/sim/standalone/start", simStartStandaloneController(s.orchestrator));
}

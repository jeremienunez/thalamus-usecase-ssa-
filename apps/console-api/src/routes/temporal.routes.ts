import type { FastifyInstance } from "fastify";
import {
  type TemporalControllerPort,
  type TemporalShadowControllerPort,
  temporalPatternsController,
  temporalShadowRunController,
} from "../controllers/temporal.controller";

export function registerTemporalRoutes(
  app: FastifyInstance,
  services: {
    memory: TemporalControllerPort;
    shadow: TemporalShadowControllerPort;
  },
): void {
  app.get<{ Querystring: unknown }>(
    "/api/cortex/temporal-patterns",
    temporalPatternsController(services.memory),
  );
  app.post<{ Body: unknown }>(
    "/api/temporal/shadow-runs",
    temporalShadowRunController(services.shadow),
  );
}

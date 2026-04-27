import type { FastifyInstance } from "fastify";
import {
  type TemporalControllerPort,
  temporalPatternsController,
} from "../controllers/temporal.controller";

export function registerTemporalRoutes(
  app: FastifyInstance,
  service: TemporalControllerPort,
): void {
  app.get<{ Querystring: unknown }>(
    "/api/cortex/temporal-patterns",
    temporalPatternsController(service),
  );
}

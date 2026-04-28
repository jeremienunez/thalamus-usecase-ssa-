import type { FastifyInstance } from "fastify";
import {
  type TemporalControllerPort,
  type TemporalPatternReviewControllerPort,
  type TemporalShadowControllerPort,
  temporalPatternReviewController,
  temporalPatternsController,
  temporalShadowRunController,
} from "../controllers/temporal.controller";

export function registerTemporalRoutes(
  app: FastifyInstance,
  services: {
    memory: TemporalControllerPort;
    review: TemporalPatternReviewControllerPort;
    shadow: TemporalShadowControllerPort;
  },
): void {
  app.get<{ Querystring: unknown }>(
    "/api/cortex/temporal-patterns",
    temporalPatternsController(services.memory),
  );
  app.post<{ Params: unknown; Body: unknown }>(
    "/api/temporal/patterns/:id/review",
    temporalPatternReviewController(services.review),
  );
  app.post<{ Body: unknown }>(
    "/api/temporal/shadow-runs",
    temporalShadowRunController(services.shadow),
  );
}

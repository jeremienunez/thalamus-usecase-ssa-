// apps/console-api/src/routes/reflexion.routes.ts
import type { FastifyInstance } from "fastify";
import type { ReflexionService } from "../services/reflexion.service";
import type { ReflexionPassBody } from "../schemas";
import { reflexionController } from "../controllers/reflexion.controller";

export function registerReflexionRoutes(
  app: FastifyInstance,
  service: ReflexionService,
): void {
  app.post<{ Body: ReflexionPassBody }>(
    "/api/sweep/reflexion-pass",
    reflexionController(service),
  );
}

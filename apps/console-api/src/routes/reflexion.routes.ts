// apps/console-api/src/routes/reflexion.routes.ts
import type { FastifyInstance } from "fastify";
import type { ReflexionService } from "../services/reflexion.service";
import type { ReflexionPassInput } from "../types/reflexion.types";
import { reflexionController } from "../controllers/reflexion.controller";

export function registerReflexionRoutes(
  app: FastifyInstance,
  service: ReflexionService,
): void {
  app.post<{ Body: ReflexionPassInput }>(
    "/api/sweep/reflexion-pass",
    reflexionController(service),
  );
}

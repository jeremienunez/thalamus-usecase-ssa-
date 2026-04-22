// apps/console-api/src/routes/reflexion.routes.ts
import type { FastifyInstance } from "fastify";
import type { ReflexionPassInput } from "../types/reflexion.types";
import {
  type ReflexionControllerPort,
  reflexionController,
} from "../controllers/reflexion.controller";

export function registerReflexionRoutes(
  app: FastifyInstance,
  service: ReflexionControllerPort,
): void {
  app.post<{ Body: ReflexionPassInput }>(
    "/api/sweep/reflexion-pass",
    reflexionController(service),
  );
}

import type { FastifyInstance } from "fastify";
import { healthController } from "../controllers/health.controller";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", healthController);
}

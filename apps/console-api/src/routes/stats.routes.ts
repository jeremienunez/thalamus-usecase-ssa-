import type { FastifyInstance } from "fastify";
import { type StatsControllerPort, statsController } from "../controllers/stats.controller";

export function registerStatsRoutes(
  app: FastifyInstance,
  service: StatsControllerPort,
): void {
  app.get("/api/stats", statsController(service));
}

import type { FastifyInstance } from "fastify";
import type { StatsService } from "../services/stats.service";
import { statsController } from "../controllers/stats.controller";

export function registerStatsRoutes(
  app: FastifyInstance,
  service: StatsService,
): void {
  app.get("/api/stats", statsController(service));
}

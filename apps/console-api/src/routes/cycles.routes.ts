// apps/console-api/src/routes/cycles.routes.ts
import type { FastifyInstance } from "fastify";
import type { CycleKind } from "../types";
import type { CycleRunnerService } from "../services/cycle-runner.service";
import {
  cycleRunController,
  cycleHistoryController,
} from "../controllers/cycles.controller";

export function registerCyclesRoutes(
  app: FastifyInstance,
  service: CycleRunnerService,
): void {
  app.post<{ Body: { kind?: CycleKind; query?: string } }>(
    "/api/cycles/run",
    cycleRunController(service),
  );
  app.get("/api/cycles", cycleHistoryController(service));
}

// apps/console-api/src/routes/cycles.routes.ts
import type { FastifyInstance } from "fastify";
import type { CycleKind } from "../types";
import {
  type CyclesControllerPort,
  cycleRunController,
  cycleHistoryController,
} from "../controllers/cycles.controller";

export function registerCyclesRoutes(
  app: FastifyInstance,
  service: CyclesControllerPort,
): void {
  app.post<{ Body: { kind?: CycleKind; query?: string } }>(
    "/api/cycles/run",
    cycleRunController(service),
  );
  app.get("/api/cycles", cycleHistoryController(service));
}

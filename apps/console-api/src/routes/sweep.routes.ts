// apps/console-api/src/routes/sweep.routes.ts
import type { FastifyInstance } from "fastify";
import type { MissionService } from "../services/mission.service";
import {
  sweepSuggestionsListController,
  sweepReviewController,
  type SweepDeps,
} from "../controllers/sweep-suggestions.controller";
import {
  missionStartController,
  missionStopController,
  missionStatusController,
} from "../controllers/sweep-mission.controller";

export function registerSweepRoutes(
  app: FastifyInstance,
  deps: SweepDeps,
  mission: MissionService,
): void {
  app.get("/api/sweep/suggestions", sweepSuggestionsListController(deps));
  app.post<{
    Params: { id: string };
    Body: { accept: boolean; reason?: string };
  }>("/api/sweep/suggestions/:id/review", sweepReviewController(deps));
  app.post<{ Body: { maxSatsPerSuggestion?: number } }>(
    "/api/sweep/mission/start",
    missionStartController(mission),
  );
  app.post("/api/sweep/mission/stop", missionStopController(mission));
  app.get("/api/sweep/mission/status", missionStatusController(mission));
}

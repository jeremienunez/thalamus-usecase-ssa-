import type { FastifyInstance } from "fastify";
import { simInjectController } from "../controllers/sim-god-channel.controller";
import {
  simPauseController,
  simResumeController,
  simScheduleNextController,
  simStatusController,
} from "../controllers/sim-orchestrator.controller";
import { simTargetsController } from "../controllers/sim-target.controller";
import {
  simAgentSubjectController,
  simAuthorLabelsController,
} from "../controllers/sim-fleet.controller";
import type { SimRouteServices } from "./sim-route-services";

export function registerSimControlRoutes(
  app: FastifyInstance,
  s: SimRouteServices,
): void {
  app.post("/api/sim/runs/:id/pause", simPauseController(s.orchestrator));
  app.post("/api/sim/runs/:id/resume", simResumeController(s.orchestrator));
  app.post(
    "/api/sim/runs/:id/schedule-next",
    simScheduleNextController(s.orchestrator),
  );
  app.get("/api/sim/runs/:id/status", simStatusController(s.orchestrator));
  app.post("/api/sim/runs/:id/inject", simInjectController(s.godChannel));
  app.get("/api/sim/runs/:id/targets", simTargetsController(s.target));
  app.get("/api/sim/subjects/:kind/:id", simAgentSubjectController(s.fleet));
  app.post("/api/sim/subjects/author-labels", simAuthorLabelsController(s.fleet));
}

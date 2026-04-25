import type { FastifyInstance } from "fastify";
import {
  type SimOperatorPort,
  simOperatorAskQuestionController,
  simOperatorClustersController,
  simOperatorEventsController,
  simOperatorEvidenceController,
  simOperatorFishTimelineController,
  simOperatorFishTraceController,
  simOperatorListSwarmsController,
  simOperatorStatusController,
} from "../controllers/sim-operator.controller";

interface SimOperatorRouteServices {
  operator: SimOperatorPort;
}

export function registerSimOperatorRoutes(
  app: FastifyInstance,
  s: SimOperatorRouteServices,
): void {
  app.get("/api/sim/operator/swarms", simOperatorListSwarmsController(s.operator));
  app.get(
    "/api/sim/operator/swarms/:id/status",
    simOperatorStatusController(s.operator),
  );
  app.get(
    "/api/sim/operator/swarms/:id/events",
    simOperatorEventsController(s.operator),
  );
  app.get(
    "/api/sim/operator/swarms/:id/fish/:fishIndex/timeline",
    simOperatorFishTimelineController(s.operator),
  );
  app.get(
    "/api/sim/operator/swarms/:id/clusters",
    simOperatorClustersController(s.operator),
  );
  app.get(
    "/api/sim/operator/swarms/:id/fish/:fishIndex/trace",
    simOperatorFishTraceController(s.operator),
  );
  app.post(
    "/api/sim/operator/swarms/:id/qa",
    simOperatorAskQuestionController(s.operator),
  );
  app.get(
    "/api/sim/operator/swarms/:id/evidence",
    simOperatorEvidenceController(s.operator),
  );
}

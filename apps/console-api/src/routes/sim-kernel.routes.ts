import type { FastifyInstance } from "fastify";
import {
  simPromotionFromModalController,
  simPromotionTelemetryController,
} from "../controllers/sim-promotion.controller";
import {
  simQueueSwarmAggregateController,
  simQueueSwarmFishController,
  simQueueTurnController,
} from "../controllers/sim-queue.controller";
import type { SimRouteServices } from "./sim-route-services";

export function registerSimKernelRoutes(
  app: FastifyInstance,
  s: SimRouteServices,
): void {
  app.post("/api/sim/queue/sim-turn", simQueueTurnController(s.queue));
  app.post("/api/sim/queue/swarm-fish", simQueueSwarmFishController(s.queue));
  app.post(
    "/api/sim/queue/swarm-aggregate",
    simQueueSwarmAggregateController(s.queue),
  );
  app.post("/api/sim/promotions/modal", simPromotionFromModalController(s.promotion));
  app.post(
    "/api/sim/promotions/scalars",
    simPromotionTelemetryController(s.promotion),
  );
}

// apps/console-api/src/routes/knn-propagation.routes.ts
import type { FastifyInstance } from "fastify";
import type { KnnPropagateBody } from "../schemas";
import {
  type KnnPropagationControllerPort,
  knnPropagateController,
} from "../controllers/knn-propagation.controller";

export function registerKnnPropagationRoutes(
  app: FastifyInstance,
  service: KnnPropagationControllerPort,
): void {
  app.post<{ Body: KnnPropagateBody }>(
    "/api/sweep/mission/knn-propagate",
    knnPropagateController(service),
  );
}

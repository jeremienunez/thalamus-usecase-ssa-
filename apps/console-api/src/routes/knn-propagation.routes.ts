// apps/console-api/src/routes/knn-propagation.routes.ts
import type { FastifyInstance } from "fastify";
import type { KnnPropagationService } from "../services/knn-propagation.service";
import type { KnnPropagateBody } from "../schemas";
import { knnPropagateController } from "../controllers/knn-propagation.controller";

export function registerKnnPropagationRoutes(
  app: FastifyInstance,
  service: KnnPropagationService,
): void {
  app.post<{ Body: KnnPropagateBody }>(
    "/api/sweep/mission/knn-propagate",
    knnPropagateController(service),
  );
}

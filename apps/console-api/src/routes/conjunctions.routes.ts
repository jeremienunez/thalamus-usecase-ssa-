import type { FastifyInstance } from "fastify";
import type { ConjunctionViewService } from "../services/conjunction-view.service";
import {
  conjunctionsController,
  screenController,
  knnCandidatesController,
} from "../controllers/conjunctions.controller";

export function registerConjunctionRoutes(
  app: FastifyInstance,
  service: ConjunctionViewService,
): void {
  app.get<{ Querystring: { minPc?: string } }>(
    "/api/conjunctions",
    conjunctionsController(service),
  );
  app.get("/api/conjunctions/screen", screenController(service));
  app.get("/api/conjunctions/knn-candidates", knnCandidatesController(service));
}

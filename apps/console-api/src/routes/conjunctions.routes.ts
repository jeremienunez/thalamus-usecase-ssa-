import type { FastifyInstance } from "fastify";
import {
  type ConjunctionsControllerPort,
  conjunctionsController,
  screenController,
  knnCandidatesController,
} from "../controllers/conjunctions.controller";

export function registerConjunctionRoutes(
  app: FastifyInstance,
  service: ConjunctionsControllerPort,
): void {
  app.get<{ Querystring: { minPc?: string } }>(
    "/api/conjunctions",
    conjunctionsController(service),
  );
  app.get("/api/conjunctions/screen", screenController(service));
  app.get("/api/conjunctions/knn-candidates", knnCandidatesController(service));
}

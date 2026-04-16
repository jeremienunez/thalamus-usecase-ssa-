import type { FastifyInstance } from "fastify";
import type { ConjunctionViewService } from "../services/conjunction-view.service";
import { conjunctionsController } from "../controllers/conjunctions.controller";

export function registerConjunctionRoutes(
  app: FastifyInstance,
  service: ConjunctionViewService,
): void {
  app.get<{ Querystring: { minPc?: string } }>(
    "/api/conjunctions",
    conjunctionsController(service),
  );
}

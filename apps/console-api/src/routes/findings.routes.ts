import type { FastifyInstance } from "fastify";
import {
  type FindingsControllerPort,
  findingsListController,
  findingByIdController,
  findingDecisionController,
} from "../controllers/findings.controller";

export function registerFindingsRoutes(
  app: FastifyInstance,
  service: FindingsControllerPort,
): void {
  app.get<{ Querystring: { status?: string; cortex?: string } }>(
    "/api/findings",
    findingsListController(service),
  );
  app.get<{ Params: { id: string } }>(
    "/api/findings/:id",
    findingByIdController(service),
  );
  app.post<{
    Params: { id: string };
    Body: { decision: string };
  }>("/api/findings/:id/decision", findingDecisionController(service));
}

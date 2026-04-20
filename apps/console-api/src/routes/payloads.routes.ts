import type { FastifyInstance } from "fastify";
import type { PayloadViewService } from "../services/payload-view.service";
import { payloadsController } from "../controllers/payloads.controller";

export function registerPayloadsRoutes(
  app: FastifyInstance,
  service: PayloadViewService,
): void {
  app.get<{ Params: { id: string } }>(
    "/api/satellites/:id/payloads",
    payloadsController(service),
  );
}

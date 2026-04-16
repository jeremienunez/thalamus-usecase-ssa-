// apps/console-api/src/controllers/autonomy.controller.ts
import type { FastifyRequest } from "fastify";
import type { AutonomyService } from "../services/autonomy.service";
import { asyncHandler } from "../utils/async-handler";

export function autonomyStartController(service: AutonomyService) {
  return asyncHandler<FastifyRequest<{ Body: { intervalSec?: number } }>>(
    async (req) => {
      return service.start(Number(req.body?.intervalSec ?? 45));
    },
  );
}

export function autonomyStopController(service: AutonomyService) {
  return asyncHandler(async () => service.stop());
}

export function autonomyStatusController(service: AutonomyService) {
  return asyncHandler(async () => service.publicState());
}

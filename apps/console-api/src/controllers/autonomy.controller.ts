// apps/console-api/src/controllers/autonomy.controller.ts
import type { FastifyRequest } from "fastify";
import type { AutonomyService } from "../services/autonomy.service";
import { asyncHandler } from "../utils/async-handler";

const DEFAULT_INTERVAL_SEC = 45;

export function autonomyStartController(service: AutonomyService) {
  return asyncHandler<FastifyRequest<{ Body: { intervalSec?: number } }>>(
    async (req) => {
      const raw = req.body?.intervalSec;
      const n = typeof raw === "number" ? raw : Number(raw);
      const intervalSec = Number.isFinite(n) ? n : DEFAULT_INTERVAL_SEC;
      return service.start(intervalSec);
    },
  );
}

export function autonomyStopController(service: AutonomyService) {
  return asyncHandler(async () => service.stop());
}

export function autonomyStatusController(service: AutonomyService) {
  return asyncHandler(async () => service.publicState());
}

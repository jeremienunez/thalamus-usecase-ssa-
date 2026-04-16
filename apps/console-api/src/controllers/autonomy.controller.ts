// apps/console-api/src/controllers/autonomy.controller.ts
import type { FastifyRequest } from "fastify";
import type { AutonomyService } from "../services/autonomy.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { AutonomyStartBodySchema } from "../schemas";

export function autonomyStartController(service: AutonomyService) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, AutonomyStartBodySchema, reply);
    if (body === null) return;
    return service.start(body.intervalSec);
  });
}

export function autonomyStopController(service: AutonomyService) {
  return asyncHandler(async () => service.stop());
}

export function autonomyStatusController(service: AutonomyService) {
  return asyncHandler(async () => service.publicState());
}

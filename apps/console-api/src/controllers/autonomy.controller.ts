// apps/console-api/src/controllers/autonomy.controller.ts
import type { FastifyRequest } from "fastify";
import type { AutonomyService } from "../services/autonomy.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { AutonomyStartBodySchema } from "../schemas";

export type AutonomyControllerPort = Pick<
  AutonomyService,
  "start" | "stop" | "resetSpend" | "publicState"
>;

export function autonomyStartController(service: AutonomyControllerPort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, AutonomyStartBodySchema, reply);
    if (body === null) return;
    return service.start(body.intervalSec);
  });
}

export function autonomyStopController(service: AutonomyControllerPort) {
  return asyncHandler(async () => service.stop());
}

export function autonomyResetController(service: AutonomyControllerPort) {
  return asyncHandler(async () => service.resetSpend());
}

export function autonomyStatusController(service: AutonomyControllerPort) {
  return asyncHandler(async () => service.publicState());
}

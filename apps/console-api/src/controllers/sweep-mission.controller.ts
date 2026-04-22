// apps/console-api/src/controllers/sweep-mission.controller.ts
import type { FastifyRequest } from "fastify";
import type { MissionService } from "../services/mission.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { MissionStartBodySchema } from "../schemas";

export type MissionControllerPort = Pick<
  MissionService,
  "start" | "stop" | "publicState"
>;

export function missionStartController(service: MissionControllerPort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, MissionStartBodySchema, reply);
    if (body === null) return;
    return service.start(body);
  });
}

export function missionStopController(service: MissionControllerPort) {
  return asyncHandler(async () => service.stop());
}

export function missionStatusController(service: MissionControllerPort) {
  return asyncHandler(async () => service.publicState());
}

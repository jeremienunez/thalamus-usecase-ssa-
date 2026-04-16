// apps/console-api/src/controllers/sweep-mission.controller.ts
import type { FastifyRequest } from "fastify";
import type { MissionService } from "../services/mission.service";
import { asyncHandler } from "../utils/async-handler";

export function missionStartController(service: MissionService) {
  return asyncHandler<
    FastifyRequest<{ Body: { maxSatsPerSuggestion?: number } }>
  >(async (req) => {
    return service.start({
      maxSatsPerSuggestion: req.body?.maxSatsPerSuggestion,
    });
  });
}

export function missionStopController(service: MissionService) {
  return asyncHandler(async () => service.stop());
}

export function missionStatusController(service: MissionService) {
  return asyncHandler(async () => service.publicState());
}

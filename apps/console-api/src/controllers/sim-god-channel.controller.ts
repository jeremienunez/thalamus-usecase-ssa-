import type { FastifyRequest } from "fastify";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import type {
  GodEventInput,
  SimGodChannelService,
} from "../services/sim-god-channel.service";
import {
  GodEventInjectBodySchema,
  SimRunIdParamsSchema,
} from "../schemas/sim.schema";
import { toInjectResultDto } from "../transformers/sim-god-channel.transformer";

export function simInjectController(service: SimGodChannelService) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, GodEventInjectBodySchema, reply);
      if (body === null) return;
      const result = await service.inject(
        BigInt(params.id),
        body as GodEventInput,
      );
      return toInjectResultDto(result);
    },
  );
}

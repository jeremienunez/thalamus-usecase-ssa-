import type { FastifyRequest } from "fastify";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import type { SimTargetService } from "../services/sim-target.service";
import { SimRunIdParamsSchema } from "../schemas/sim.schema";
import { toSimTargetsDto } from "../transformers/sim-target.transformer";

export function simTargetsController(service: SimTargetService) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const bag = await service.loadTargets(BigInt(params.id));
      return toSimTargetsDto(bag);
    },
  );
}

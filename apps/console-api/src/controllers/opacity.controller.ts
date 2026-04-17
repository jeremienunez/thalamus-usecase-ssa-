import type { FastifyRequest } from "fastify";
import type { OpacityService } from "../services/opacity.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { OpacityCandidatesQuerySchema } from "../schemas";

export function opacityCandidatesController(service: OpacityService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, OpacityCandidatesQuerySchema, reply);
      if (q === null) return;
      return service.listCandidates(q);
    },
  );
}
